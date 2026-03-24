require("dotenv").config();
const express = require("express");
const cors = require("cors");
const { createClient } = require("@supabase/supabase-js");
const axios = require("axios");
const { calculateClasses, collegeConfig } = require("./attendanceCalculator");

const app = express();
app.use(cors());
app.use(express.json());

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY,
);

// ---------------------------------------------------------
// Endpoint 1: Save Attendance (POST)
// ---------------------------------------------------------
app.post("/api/sync-attendance", async (req, res) => {
  try {
    const studentAttended = req.body;
    const studentId = studentAttended.student_id || "S01";

    const classesHeldSoFar = calculateClasses(
      collegeConfig.semester_start_date,
      new Date().toISOString().split("T")[0],
    );
    const totalSemesterClasses = calculateClasses(
      collegeConfig.semester_start_date,
      collegeConfig.semester_end_date,
    );

    const { error: dbError } = await supabase.from("attendance_logs").upsert(
      {
        student_id: studentId,
        cgip_attended: parseInt(studentAttended.CGIP) || 0,
        cd_attended: parseInt(studentAttended.CD) || 0,
        ieft_attended: parseInt(studentAttended.IEFT) || 0,
        aad_attended: parseInt(studentAttended.AAD) || 0,
        elec_attended: parseInt(studentAttended.ELEC) || 0,
        last_synced: new Date().toISOString(),
      },
      { onConflict: "student_id" },
    );

    if (dbError) throw dbError;

    res.status(200).json({
      message: "Attendance synced successfully",
      classesHeldToDate: classesHeldSoFar,
      totalExpectedSemesterClasses: totalSemesterClasses,
    });
  } catch (error) {
    console.error("Save Error:", error);
    res.status(500).json({ error: "Failed to sync attendance" });
  }
});

// ---------------------------------------------------------
// Endpoint 2: Fetch Single Student Attendance (GET)
// THIS FIXES YOUR 404 ERROR!
// ---------------------------------------------------------
app.get("/api/attendance/:student_id", async (req, res) => {
  try {
    const { student_id } = req.params;

    const { data, error } = await supabase
      .from("attendance_logs")
      .select("*")
      .eq("student_id", student_id)
      .single();

    if (error) {
      // If no attendance record exists yet, return empty/zeroed data rather than crashing
      return res.status(200).json({
        cgip_attended: 0,
        cd_attended: 0,
        ieft_attended: 0,
        aad_attended: 0,
        elec_attended: 0,
      });
    }

    res.status(200).json(data);
  } catch (error) {
    console.error("Fetch Attendance Error:", error);
    res.status(500).json({ error: "Failed to fetch attendance data" });
  }
});

// ---------------------------------------------------------
// Endpoint 3: Load Dashboard Data (Merged & Fixed)
// ---------------------------------------------------------
app.get("/api/dashboard/:student_id", async (req, res) => {
  try {
    const { student_id } = req.params;

    // 1. Get the student's base info
    const { data: student, error: studentError } = await supabase
      .from("students")
      .select("*")
      .eq("id", student_id)
      .single();

    if (studentError) throw new Error("Student not found");

    // 2. Get their attendance records
    const { data: attendance } = await supabase
      .from("attendance_logs")
      .select("*")
      .eq("student_id", student_id)
      .single();

    // 3. Calculate Overall Attendance Percentage
    let attendancePercentage = 100;

    if (attendance) {
      const totalAttended =
        (attendance.cgip_attended || 0) +
        (attendance.cd_attended || 0) +
        (attendance.ieft_attended || 0) +
        (attendance.aad_attended || 0) +
        (attendance.elec_attended || 0);

      const classesHeldSoFar = calculateClasses(
        collegeConfig.semester_start_date,
        new Date().toISOString().split("T")[0],
      );

      const totalHeld =
        (classesHeldSoFar.CGIP || 0) +
        (classesHeldSoFar.CD || 0) +
        (classesHeldSoFar.IEFT || 0) +
        (classesHeldSoFar.AAD || 0) +
        (classesHeldSoFar.ELEC || 0);

      if (totalHeld > 0) {
        attendancePercentage = Math.round((totalAttended / totalHeld) * 100);
      }
    } else {
      attendancePercentage = 0; // No attendance logged yet
    }

    // 4. Request Prediction from Python ML Server
    let riskLevel = "UNKNOWN";
    let aiInsight = "AI Prediction currently unavailable.";
    let confidenceScores = {};

    try {
      const mlResponse = await axios.post(
        "http://127.0.0.1:8000/predict-dropout",
        {
          attendance_rate: attendancePercentage,
          test_scores: student.test_scores || 100,
          backlogs: student.backlogs || 0,
          assignment_score: student.assignment_score || 15,
        },
      );

      // Extracting based on both of your previous attempts
      riskLevel =
        mlResponse.data.risk_level || mlResponse.data.risk_label || "UNKNOWN";
      aiInsight = mlResponse.data.ai_insight || "No insight provided";
      confidenceScores = mlResponse.data.confidence || {};
    } catch (mlError) {
      console.error("FastAPI API Unreachable");
    }

    // 5. Send compiled data to Frontend
    res.status(200).json({
      student_name: student.name,
      attendance_percentage: attendancePercentage,
      cgpa: student.cgpa,
      test_scores: student.test_scores,
      assignment_score: student.assignment_score,
      backlogs: student.backlogs,
      risk_level: riskLevel,
      confidence_breakdown: confidenceScores,
      ai_insight: aiInsight,
    });
  } catch (error) {
    console.error("Dashboard Error:", error);
    res
      .status(500)
      .json({ error: error.message || "Failed to load dashboard data" });
  }
});

// ---------------------------------------------------------
// Endpoint 4: Subject-Wise Micro Analysis
// ---------------------------------------------------------
app.get("/api/subject-analysis/:student_id", async (req, res) => {
  try {
    const { data: attendance } = await supabase
      .from("attendance_logs")
      .select("*")
      .eq("student_id", req.params.student_id)
      .single();

    if (!attendance) return res.status(200).json([]); // Return empty if no data yet

    const held = calculateClasses(
      collegeConfig.semester_start_date,
      new Date().toISOString().split("T")[0],
    );
    const total = calculateClasses(
      collegeConfig.semester_start_date,
      collegeConfig.semester_end_date,
    );

    const analyze = (id, name, attended, heldSoFar, totalExpected) => {
      // Ensure we don't divide by zero or pass nulls
      const safeAttended = attended || 0;
      const safeHeldSoFar = heldSoFar || 0;
      const safeTotalExpected = totalExpected || 0;

      const percent =
        safeHeldSoFar > 0
          ? Math.round((safeAttended / safeHeldSoFar) * 100)
          : 0;
      const requiredFor75 = Math.ceil(0.75 * safeTotalExpected);
      const classesLeft = safeTotalExpected - safeHeldSoFar;

      let status = "good";
      let inference = "";

      if (percent < 75) {
        const needed = requiredFor75 - safeAttended;
        if (needed > classesLeft) {
          status = "critical";
          inference = `CRITICAL: Cannot reach 75%. You need ${needed} classes, but only ${classesLeft} are left.`;
        } else {
          status = "warning";
          inference = `WARNING: Falling behind. Must attend ${needed} of the next ${classesLeft} classes.`;
        }
      } else {
        const canSkip = safeAttended + classesLeft - requiredFor75;
        if (canSkip > 0) {
          inference = `SAFE: You can safely skip ${canSkip} classes and remain above 75%.`;
        } else {
          inference = `SAFE: You are exactly on track. Do not skip any upcoming classes.`;
        }
      }

      return {
        id,
        name,
        attended: safeAttended,
        held: safeHeldSoFar,
        percent,
        status,
        inference,
      };
    };

    const analysisData = [
      analyze(
        "1",
        "Computer Graphics (CGIP)",
        attendance.cgip_attended,
        held.CGIP,
        total.CGIP,
      ),
      analyze(
        "2",
        "Compiler Design (CD)",
        attendance.cd_attended,
        held.CD,
        total.CD,
      ),
      analyze(
        "3",
        "Industrial Economics (IEFT)",
        attendance.ieft_attended,
        held.IEFT,
        total.IEFT,
      ),
      analyze(
        "4",
        "Algorithm Analysis (AAD)",
        attendance.aad_attended,
        held.AAD,
        total.AAD,
      ),
      analyze(
        "5",
        "Elective (ELEC)",
        attendance.elec_attended,
        held.ELEC,
        total.ELEC,
      ),
    ];

    res.status(200).json(analysisData);
  } catch (error) {
    console.error("Subject Analysis Error:", error);
    res.status(500).json({ error: "Failed to run subject analysis" });
  }
});

const PORT = process.env.PORT || 5001;
app.listen(PORT, () => {
  console.log(`AcadAlert Backend running on port ${PORT}`);
});
