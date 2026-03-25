require("dotenv").config();
const express = require("express");
const cors = require("cors");
const { createClient } = require("@supabase/supabase-js");
const axios = require("axios");
const cron = require("node-cron");
const { calculateClasses, collegeConfig } = require("./attendanceCalculator");
const admin = require("./firebase"); // <-- Your crucial push notification import!

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
// Endpoint 3: Load Dashboard Data 
// ---------------------------------------------------------
app.get("/api/dashboard/:student_id", async (req, res) => {
  try {
    const { student_id } = req.params;

    const { data: student, error: studentError } = await supabase
      .from("students")
      .select("*")
      .eq("id", student_id)
      .single();

    if (studentError) throw new Error("Student not found");

    const { data: attendance } = await supabase
      .from("attendance_logs")
      .select("*")
      .eq("student_id", student_id)
      .single();

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
      attendancePercentage = 0; 
    }

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

      riskLevel =
        mlResponse.data.risk_level || mlResponse.data.risk_label || "UNKNOWN";
      aiInsight = mlResponse.data.ai_insight || "No insight provided";
      confidenceScores = mlResponse.data.confidence || {};
    } catch (mlError) {
      console.error("FastAPI API Unreachable");
    }

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

// GET list of all students for the faculty dashboard
app.get('/api/faculty/students', async (req, res) => {
  try {
    // 1. Fetch all records from your Supabase 'students' table
    const { data: studentsData, error } = await supabase
      .from('students')
      .select('*');

    if (error) {
      console.error("Supabase error:", error);
      return res.status(500).json({ error: "Failed to fetch students from database" });
    }

    // 2. Format the data to match exactly what the frontend React Native code expects
    const formattedStudents = studentsData.map(student => {
      
      // Calculate a dynamic risk level based on the schema data you have
      let calculatedRisk = 'Low';
      if (student.backlogs >= 2 || student.cgpa < 6.0) {
        calculatedRisk = 'High';
      } else if (student.backlogs === 1 || student.cgpa < 7.5) {
        calculatedRisk = 'Medium';
      }

      return {
        id: student.id,
        name: student.name,
        // Mocking attendance for now since it's not in the students table schema
        attendance: 80, 
        risk: calculatedRisk, 
        
        // Sending the rest of the actual data just in case you need it later
        cgpa: student.cgpa,
        backlogs: student.backlogs,
        test_scores: student.test_scores,
        assignment_score: student.assignment_score
      };
    });

    // 3. Send the formatted array back to the app
    res.json(formattedStudents);

  } catch (error) {
    console.error("Error fetching students:", error);
    res.status(500).json({ error: "Internal server error" });
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

    if (!attendance) return res.status(200).json([]); 

    const held = calculateClasses(
      collegeConfig.semester_start_date,
      new Date().toISOString().split("T")[0],
    );
    const total = calculateClasses(
      collegeConfig.semester_start_date,
      collegeConfig.semester_end_date,
    );

    const analyze = (id, name, attended, heldSoFar, totalExpected) => {
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
      analyze("1", "Computer Graphics (CGIP)", attendance.cgip_attended, held.CGIP, total.CGIP),
      analyze("2", "Compiler Design (CD)", attendance.cd_attended, held.CD, total.CD),
      analyze("3", "Industrial Economics (IEFT)", attendance.ieft_attended, held.IEFT, total.IEFT),
      analyze("4", "Algorithm Analysis (AAD)", attendance.aad_attended, held.AAD, total.AAD),
      analyze("5", "Elective (ELEC)", attendance.elec_attended, held.ELEC, total.ELEC),
    ];

    res.status(200).json(analysisData);
  } catch (error) {
    console.error("Subject Analysis Error:", error);
    res.status(500).json({ error: "Failed to run subject analysis" });
  }
});

// ---------------------------------------------------------
// Endpoint 5: Save the FCM Token to Supabase (POST)
// ---------------------------------------------------------
app.post("/api/notifications/register", async (req, res) => {
    const { userId, fcmToken } = req.body;

    if (!userId || !fcmToken) {
        return res.status(400).json({ error: "Missing userId or fcmToken" });
    }

    try {
        const { data, error: dbError } = await supabase
            .from("profiles")
            .update({ fcm_token: fcmToken })
            .eq("id", userId)
            .select();

        if (dbError) throw dbError;

        if (!data || data.length === 0) {
            return res.status(404).json({ error: "User not found or update blocked by RLS" });
        }

        console.log(`Successfully registered token for user ${userId}`);
        res.status(200).json({ message: "Token registered successfully", data });
    } catch (error) {
        console.error("Error saving token:", error);
        res.status(500).json({ error: "Failed to register token" });
    }
});

// ---------------------------------------------------------
// Endpoint 6: Trigger a Push Notification (POST)
// ---------------------------------------------------------
app.post("/api/notifications/send", async (req, res) => {
    const { targetToken, title, body } = req.body;

    if (!targetToken) {
        return res.status(400).json({ error: "Target token is required" });
    }

    const message = {
        notification: {
            title: title || "AcadAlert Update",
            body: body || "Check your dashboard for new insights."
        },
        token: targetToken
    };

    try {
        const response = await admin.messaging().send(message);
        console.log("Successfully sent message:", response);
        res.status(200).json({ success: true, messageId: response });
    } catch (error) {
        console.error("Error sending message:", error);
        res.status(500).json({ error: "Failed to send notification" });
    }
});

// ---------------------------------------------------------
// Endpoint 7: The Automated Assignment Watcher (Cron Job)
// ---------------------------------------------------------
// This runs every single minute ('* * * * *')
cron.schedule("* * * * *", async () => {
  console.log("🕰️ Checking for due assignments...");
  const now = new Date().toISOString();

  try {
    const { data: assignments, error } = await supabase
      .from("pending_assignments")
      .select(
        `
        id, 
        title, 
        user_id,
        profiles ( fcm_token )
      `,
      )
      .lte("due_date", now)
      .eq("is_completed", false)
      .eq("notification_sent", false);

    if (error) throw error;

    if (assignments && assignments.length > 0) {
      console.log(
        `🚨 Found ${assignments.length} assignments due! Sending alerts...`,
      );

      for (const task of assignments) {
        console.log(
          `➡️ Processing task: "${task.title}" for user: ${task.user_id}`,
        );
        console.log("➡️ Joined profile data:", task.profiles);

        let token = null;
        if (Array.isArray(task.profiles)) {
          token = task.profiles[0]?.fcm_token;
        } else {
          token = task.profiles?.fcm_token;
        }

        console.log("➡️ Extracted Token:", token);

        if (!token) {
          console.log(
            "❌ FAILED: Token is missing or Supabase RLS blocked the profile read!",
          );
          continue;
        }

        try {
          console.log("➡️ Attempting to send payload to Firebase...");
          const message = {
            notification: {
              title: "Assignment Due! ⏰",
              body: `Your task "${task.title}" is due right now!`,
            },
            token: token,
          };

          await admin.messaging().send(message);
          console.log("✅ Firebase success! Updating Supabase...");

          const { error: updateError } = await supabase
            .from("pending_assignments")
            .update({ notification_sent: true })
            .eq("id", task.id);

          if (updateError) throw updateError;

          console.log(`✅ Database updated for task: ${task.title}`);
        } catch (innerError) {
          console.error(
            `❌ FIREBASE/DB ERROR for task ${task.id}:`,
            innerError.message,
          );
        }
      }
    }
  } catch (err) {
    console.error("Cron job error:", err);
  }
});

const PORT = process.env.PORT || 5001;
app.listen(PORT, () => {
  console.log(`AcadAlert Backend running on port ${PORT}`);
});