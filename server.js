require("dotenv").config();
const express = require("express");
const cors = require("cors");
const { createClient } = require("@supabase/supabase-js");

const app = express();

// Allow your frontend teammates to connect
app.use(cors());
app.use(express.json());

// Initialize Supabase
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY,
);

// Endpoint 1: Save Attendance (Frontend POSTs to this)
app.post("/api/attendance", async (req, res) => {
  const { student_id, date, subject, status } = req.body;

  const { data, error } = await supabase
    .from("attendance_logs")
    .insert([{ student_id, date, subject, status }]);

  if (error) return res.status(400).json({ error: error.message });
  res.status(200).json({ message: "Attendance logged successfully", data });
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

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`AcadAlert Backend running on port ${PORT}`);
});
