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

// Endpoint 2: Load Dashboard Data (Frontend GETs from this)
app.get("/api/dashboard/:student_id", async (req, res) => {
  const { student_id } = req.params;

  // 1. Get the student's base info
  const { data: student, error: studentError } = await supabase
    .from("students")
    .select("*")
    .eq("id", student_id)
    .single();

  if (studentError) return res.status(404).json({ error: "Student not found" });

  // 2. Get their attendance records
  const { data: attendance, error: attError } = await supabase
    .from("attendance_logs")
    .select("status")
    .eq("student_id", student_id);

  // 3. Calculate Attendance Percentage
  let attendancePercentage = 100;
  if (attendance && attendance.length > 0) {
    const presentCount = attendance.filter(
      (a) => a.status === "Present",
    ).length;
    attendancePercentage = Math.round((presentCount / attendance.length) * 100);
  }

  // ---------------------------------------------------------
  // 4. NEW: Request Prediction from the Python ML Server
  // ---------------------------------------------------------
  let riskLevel = "UNKNOWN";
  let aiInsight = "AI Prediction currently unavailable.";

  try {
    // MATCHING THE MODEL SPEC EXACTLY
    const mlPayload = {
      attendance_rate: attendancePercentage,
      test_scores: student.test_score || 0,
      backlogs: student.backlogs || 0,
      assignment_score: student.assignment_score || 15.0,
    };

    const mlResponse = await fetch("http://127.0.0.1:8000/predict-dropout", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(mlPayload),
    });

    if (mlResponse.ok) {
      const mlData = await mlResponse.json();
      riskLevel = mlData.risk_level;
      aiInsight = mlData.ai_insight;
    } else {
      console.error("FastAPI returned an error:", mlResponse.statusText);
    }
  } catch (error) {
    console.error("Could not connect to Python ML Server:", error.message);
  }

  // 5. Send the final compiled data back to the Frontend
  res.status(200).json({
    student_name: student.name,
    attendance_percentage: attendancePercentage,
    cgpa: student.cgpa,
    backlogs: student.backlogs,
    risk_level: riskLevel,
    ai_insight: aiInsight,
  });
});

// ---------------------------------------------------------
// Endpoint 3: Load Dashboard & Run ML Model (GET)
// ---------------------------------------------------------
app.get("/api/dashboard/:student_id", async (req, res) => {
  try {
    const { student_id } = req.params;

    const { data: student, error: studentError } = await supabase
      .from("students")
      .select("*")
      .eq("id", student_id)
      .single();
    if (studentError) throw studentError;

    const { data: attendance } = await supabase
      .from("attendance_logs")
      .select("*")
      .eq("student_id", student_id)
      .single();

    let attendancePercentage = 100;
    if (attendance) {
      const totalAttended =
        attendance.cgip_attended +
        attendance.cd_attended +
        attendance.ieft_attended +
        attendance.aad_attended +
        attendance.elec_attended;
      const classesHeldSoFar = calculateClasses(
        collegeConfig.semester_start_date,
        new Date().toISOString().split("T")[0],
      );
      const totalHeld =
        classesHeldSoFar.CGIP +
        classesHeldSoFar.CD +
        classesHeldSoFar.IEFT +
        classesHeldSoFar.AAD +
        classesHeldSoFar.ELEC;

      if (totalHeld > 0) {
        attendancePercentage = parseFloat(
          ((totalAttended / totalHeld) * 100).toFixed(2),
        );
      }
    }

    let riskLevel = "UNKNOWN";
    let aiInsight = "Could not reach AI model.";
    let confidenceScores = {};

    try {
      const mlResponse = await axios.post(
        "http://127.0.0.1:8000/predict-dropout",
        {
          attendance_rate: attendancePercentage,
          test_scores: student.test_scores || 0,
          backlogs: student.backlogs || 0,
          assignment_score: student.assignment_score || 0,
        },
      );

      riskLevel = mlResponse.data.risk_label;
      aiInsight = mlResponse.data.ai_insight;
      confidenceScores = mlResponse.data.confidence;
    } catch (mlError) {
      console.error("Flask API Unreachable");
    }

    res.status(200).json({
      student_name: student.name,
      attendance_rate: attendancePercentage,
      test_scores: student.test_scores,
      assignment_score: student.assignment_score,
      backlogs: student.backlogs,
      risk_level: riskLevel,
      confidence_breakdown: confidenceScores,
      ai_insight: aiInsight,
    });
  } catch (error) {
    console.error("Dashboard Error:", error);
    res.status(500).json({ error: "Failed to load dashboard data" });
  }
});

// ---------------------------------------------------------
// Endpoint 4: Subject-Wise Micro Analysis (GET)
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
      const percent =
        heldSoFar > 0 ? Math.round((attended / heldSoFar) * 100) : 0;
      const requiredFor75 = Math.ceil(0.75 * totalExpected);
      const classesLeft = totalExpected - heldSoFar;

      let status = "good";
      let inference = "";

      if (percent < 75) {
        const needed = requiredFor75 - attended;
        if (needed > classesLeft) {
          status = "critical";
          inference = `CRITICAL: Cannot reach 75%. You need ${needed} classes, but only ${classesLeft} are left.`;
        } else {
          status = "warning";
          inference = `WARNING: Falling behind. Must attend ${needed} of the next ${classesLeft} classes.`;
        }
      } else {
        const canSkip = attended + classesLeft - requiredFor75;
        if (canSkip > 0) {
          inference = `SAFE: You can safely skip ${canSkip} classes and remain above 75%.`;
        } else {
          inference = `SAFE: You are exactly on track. Do not skip any upcoming classes.`;
        }
      }

      return {
        id,
        name,
        attended,
        held: heldSoFar,
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

// ---------------------------------------------------------
// Endpoint 5: Load All Students for Faculty Dashboard (GET)
// ---------------------------------------------------------
app.get("/api/faculty/students", async (req, res) => {
  try {
    // 1. Fetch ALL students
    const { data: students, error: studentError } = await supabase
      .from("students")
      .select("id, name, backlogs");

    if (studentError) throw studentError;

    // 2. Fetch ALL attendance logs
    const { data: attendanceLogs, error: attError } = await supabase
      .from("attendance_logs")
      .select("*");

    if (attError) throw attError;

    // 3. Calculate total classes held to date using your existing logic
    const classesHeldSoFar = calculateClasses(
      collegeConfig.semester_start_date,
      new Date().toISOString().split("T")[0]
    );
    const totalHeld = 
      classesHeldSoFar.CGIP + 
      classesHeldSoFar.CD + 
      classesHeldSoFar.IEFT + 
      classesHeldSoFar.AAD + 
      classesHeldSoFar.ELEC;

    // 4. Map the data together for the React Native UI
    const formattedStudents = students.map(student => {
      const record = attendanceLogs.find(log => log.student_id === student.id);
      
      let attendancePercentage = 0;
      if (record && totalHeld > 0) {
        const totalAttended = 
          (record.cgip_attended || 0) + 
          (record.cd_attended || 0) + 
          (record.ieft_attended || 0) + 
          (record.aad_attended || 0) + 
          (record.elec_attended || 0);
          
        attendancePercentage = Math.round((totalAttended / totalHeld) * 100);
      }

      // 5. Basic Risk Assessment for the list view
      // (Running the Python ML model for 60 students at once would slow down the app, 
      // so we use a fast heuristic here for the overview list)
      let risk = "Low";
      if (attendancePercentage < 65 || student.backlogs > 2) risk = "High";
      else if (attendancePercentage < 75 || student.backlogs > 0) risk = "Medium";

      return {
        id: student.id,
        name: student.name,
        attendance: attendancePercentage,
        risk: risk
      };
    });

    res.status(200).json(formattedStudents);
  } catch (error) {
    console.error("Error fetching faculty students:", error);
    res.status(500).json({ error: "Failed to load student list" });
  }
});

// ---------------------------------------------------------
// Endpoint 6: Save Bulk Attendance (POST)
// ---------------------------------------------------------
app.post("/api/faculty/bulk-attendance", async (req, res) => {
  try {
    const { attendance, date } = req.body;
    
    // Fetch current attendance logs to increment them
    const { data: currentLogs, error: fetchError } = await supabase
      .from("attendance_logs")
      .select("*");

    if (fetchError) throw fetchError;

    const updates = [];

    for (const [studentId, isPresent] of Object.entries(attendance)) {
      if (isPresent) {
        const studentLog = currentLogs.find(log => log.student_id === studentId);
        
        // IMPORTANT NOTE: Because your database tracks attendance by SUBJECT 
        // (cgip_attended, cd_attended), a "Bulk Mark" without a subject is tricky.
        // For now, this will add +1 to a specific subject (e.g., ELEC) so you can test it.
        // Later, we should add a dropdown in the app so the teacher selects WHICH subject they are marking!
        
        const currentElec = studentLog ? (studentLog.elec_attended || 0) : 0;

        updates.push({
          student_id: studentId,
          elec_attended: currentElec + 1, // Incrementing Elective classes as a test
          last_synced: new Date().toISOString()
        });
      }
    }

    if (updates.length > 0) {
      const { error: updateError } = await supabase
        .from("attendance_logs")
        .upsert(updates, { onConflict: "student_id" });

      if (updateError) throw updateError;
    }

    res.status(200).json({ message: "Attendance saved to Supabase successfully" });
  } catch (error) {
    console.error("Bulk Attendance Error:", error);
    res.status(500).json({ error: "Failed to process bulk attendance" });
  }
});

const PORT = process.env.PORT || 5001;
app.listen(PORT, () => {
  console.log(`AcadAlert Backend running on port ${PORT}`);
});
