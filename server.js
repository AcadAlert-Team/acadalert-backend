require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { createClient } = require('@supabase/supabase-js');
const axios = require('axios');
const { calculateClasses, collegeConfig } = require('./attendanceCalculator');

const app = express();
app.use(cors());
app.use(express.json());

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

// ---------------------------------------------------------
// Endpoint 1: Save Attendance (POST)
// ---------------------------------------------------------
app.post('/api/sync-attendance', async (req, res) => {
 try {
   const studentAttended = req.body;
   const studentId = studentAttended.student_id || 'S01';

   const classesHeldSoFar = calculateClasses(collegeConfig.semester_start_date, new Date().toISOString().split('T')[0]);
   const totalSemesterClasses = calculateClasses(collegeConfig.semester_start_date, collegeConfig.semester_end_date);

   const { error: dbError } = await supabase
     .from('attendance_logs')
     .upsert({
       student_id: studentId,
       cgip_attended: parseInt(studentAttended.CGIP) || 0,
       cd_attended: parseInt(studentAttended.CD) || 0,
       ieft_attended: parseInt(studentAttended.IEFT) || 0,
       aad_attended: parseInt(studentAttended.AAD) || 0,
       elec_attended: parseInt(studentAttended.ELEC) || 0,
       last_synced: new Date().toISOString()
     }, { onConflict: 'student_id' });

   if (dbError) throw dbError;

   res.status(200).json({
     message: "Attendance synced successfully",
     classesHeldToDate: classesHeldSoFar,
     totalExpectedSemesterClasses: totalSemesterClasses
   });
 } catch (error) {
   console.error("Save Error:", error);
   res.status(500).json({ error: "Failed to sync attendance" });
 }
});

// ---------------------------------------------------------
// Endpoint 2: Get Previous Attendance (GET)
// ---------------------------------------------------------
app.get('/api/attendance/:student_id', async (req, res) => {
   const { data, error } = await supabase
       .from('attendance_logs')
       .select('*')
       .eq('student_id', req.params.student_id)
       .single();
  
   if (error) return res.status(200).json({});
   res.status(200).json(data);
});

// ---------------------------------------------------------
// Endpoint 3: Load Dashboard & Run ML Model (GET)
// ---------------------------------------------------------
app.get('/api/dashboard/:student_id', async (req, res) => {
   try {
       const { student_id } = req.params;

       const { data: student, error: studentError } = await supabase.from('students').select('*').eq('id', student_id).single();
       if (studentError) throw studentError;

       const { data: attendance } = await supabase.from('attendance_logs').select('*').eq('student_id', student_id).single();

       let attendancePercentage = 100;
       if (attendance) {
           const totalAttended = attendance.cgip_attended + attendance.cd_attended + attendance.ieft_attended + attendance.aad_attended + attendance.elec_attended;
           const classesHeldSoFar = calculateClasses(collegeConfig.semester_start_date, new Date().toISOString().split('T')[0]);
           const totalHeld = classesHeldSoFar.CGIP + classesHeldSoFar.CD + classesHeldSoFar.IEFT + classesHeldSoFar.AAD + classesHeldSoFar.ELEC;

           if (totalHeld > 0) {
               attendancePercentage = parseFloat(((totalAttended / totalHeld) * 100).toFixed(2));
           }
       }

       let riskLevel = "UNKNOWN";
       let aiInsight = "Could not reach AI model.";
       let confidenceScores = {};

       try {
           const mlResponse = await axios.post("http://127.0.0.1:8000/predict-dropout", {
               attendance_rate: attendancePercentage,
               test_scores: student.test_scores || 0,
               backlogs: student.backlogs || 0,
               assignment_score: student.assignment_score || 0
           });
          
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
           ai_insight: aiInsight
       });

   } catch (error) {
       console.error("Dashboard Error:", error);
       res.status(500).json({ error: "Failed to load dashboard data" });
   }
});

// ---------------------------------------------------------
// Endpoint 4: Subject-Wise Micro Analysis (GET)
// ---------------------------------------------------------
app.get('/api/subject-analysis/:student_id', async (req, res) => {
   try {
       const { data: attendance } = await supabase
           .from('attendance_logs')
           .select('*')
           .eq('student_id', req.params.student_id)
           .single();

       if (!attendance) return res.status(200).json([]); // Return empty if no data yet

       const held = calculateClasses(collegeConfig.semester_start_date, new Date().toISOString().split('T')[0]);
       const total = calculateClasses(collegeConfig.semester_start_date, collegeConfig.semester_end_date);

       const analyze = (id, name, attended, heldSoFar, totalExpected) => {
           const percent = heldSoFar > 0 ? Math.round((attended / heldSoFar) * 100) : 0;
           const requiredFor75 = Math.ceil(0.75 * totalExpected);
           const classesLeft = totalExpected - heldSoFar;
          
           let status = 'good';
           let inference = '';

           if (percent < 75) {
               const needed = requiredFor75 - attended;
               if (needed > classesLeft) {
                   status = 'critical';
                   inference = `CRITICAL: Cannot reach 75%. You need ${needed} classes, but only ${classesLeft} are left.`;
               } else {
                   status = 'warning';
                   inference = `WARNING: Falling behind. Must attend ${needed} of the next ${classesLeft} classes.`;
               }
           } else {
               const canSkip = (attended + classesLeft) - requiredFor75;
               if (canSkip > 0) {
                   inference = `SAFE: You can safely skip ${canSkip} classes and remain above 75%.`;
               } else {
                   inference = `SAFE: You are exactly on track. Do not skip any upcoming classes.`;
               }
           }

           return { id, name, attended, held: heldSoFar, percent, status, inference };
       };

       const analysisData = [
           analyze('1', 'Computer Graphics (CGIP)', attendance.cgip_attended, held.CGIP, total.CGIP),
           analyze('2', 'Compiler Design (CD)', attendance.cd_attended, held.CD, total.CD),
           analyze('3', 'Industrial Economics (IEFT)', attendance.ieft_attended, held.IEFT, total.IEFT),
           analyze('4', 'Algorithm Analysis (AAD)', attendance.aad_attended, held.AAD, total.AAD),
           analyze('5', 'Elective (ELEC)', attendance.elec_attended, held.ELEC, total.ELEC)
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
