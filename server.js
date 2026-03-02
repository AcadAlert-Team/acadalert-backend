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

  try {
    const { data: student, error: studentError } = await supabase
      .from("students")
      .select("*")
      .eq("id", student_id)
      .single();

    if (studentError)
      return res.status(404).json({ error: "Student not found" });

    const { data: attendance, error: attError } = await supabase
      .from("attendance_logs")
      .select("status")
      .eq("student_id", student_id);

    let attendancePercentage = 100;
    if (attendance && attendance.length > 0) {
      const presentCount = attendance.filter(
        (a) => a.status === "Present",
      ).length;
      attendancePercentage = Math.round(
        (presentCount / attendance.length) * 100,
      );
    }

    let riskLevel = "UNKNOWN";
    let aiInsight = "Could not reach AI model.";
    let confidenceScores = {}; // New variable for probabilities

    try {
      // UPDATED: Sending exact variable names matching your model spec
      const mlResponse = await axios.post(
        "http://127.0.0.1:8000/predict-dropout",
        {
          attendance_rate: attendancePercentage,
          test_scores: student.test_scores || 0,
          backlogs: student.backlogs || 0,
          assignment_score: student.assignment_score || 0,
        },
      );

      // UPDATED: Receiving the new structure from FastAPI
      riskLevel = mlResponse.data.risk_label;
      aiInsight = mlResponse.data.ai_insight;
      confidenceScores = mlResponse.data.confidence;
    } catch (mlError) {
      console.error("Error communicating with Python API:", mlError.message);
    }

    res.status(200).json({
      student_name: student.name,
      attendance_rate: attendancePercentage,
      test_scores: student.test_scores,
      assignment_score: student.assignment_score,
      backlogs: student.backlogs,
      risk_level: riskLevel,
      confidence_breakdown: confidenceScores, // Now sending percentages to the frontend!
      ai_insight: aiInsight,
    });
  } catch (err) {
    res.status(500).json({ error: "Internal Server Error" });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`AcadAlert Backend running on port ${PORT}`);
});
