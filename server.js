require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { createClient } = require('@supabase/supabase-js');

const app = express();

// Allow your frontend teammates to connect
app.use(cors());
app.use(express.json());

// Initialize Supabase
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

// Endpoint 1: Save Attendance (Frontend POSTs to this)
app.post('/api/attendance', async (req, res) => {
    const { student_id, date, subject, status } = req.body;
    
    const { data, error } = await supabase
        .from('attendance_logs')
        .insert([{ student_id, date, subject, status }]);

    if (error) return res.status(400).json({ error: error.message });
    res.status(200).json({ message: 'Attendance logged successfully', data });
});

// Endpoint 2: Load Dashboard Data (Frontend GETs from this)
app.get('/api/dashboard/:student_id', async (req, res) => {
    const { student_id } = req.params;

    // 1. Get the student's base info
    const { data: student, error: studentError } = await supabase
        .from('students')
        .select('*')
        .eq('id', student_id)
        .single();

    if (studentError) return res.status(404).json({ error: 'Student not found' });

    // 2. Get their attendance records
    const { data: attendance, error: attError } = await supabase
        .from('attendance_logs')
        .select('status')
        .eq('student_id', student_id);

    // 3. Calculate Attendance Percentage
    let attendancePercentage = 100;
    if (attendance && attendance.length > 0) {
        const presentCount = attendance.filter(a => a.status === 'Present').length;
        attendancePercentage = Math.round((presentCount / attendance.length) * 100);
    }

    // 4. Fake the AI Risk Logic for Tuesday's Demo
    let riskLevel = 'LOW';
    if (attendancePercentage < 75 || student.backlogs > 0) riskLevel = 'HIGH';
    else if (attendancePercentage < 85) riskLevel = 'MED';

    res.status(200).json({
        student_name: student.name,
        attendance_percentage: attendancePercentage,
        cgpa: student.cgpa,
        backlogs: student.backlogs,
        risk_level: riskLevel,
        ai_insight: riskLevel === 'HIGH' 
            ? "Immediate attention required. Attendance is critically low." 
            : "On track. Keep up the good work!"
    });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`AcadAlert Backend running on port ${PORT}`);
});