-- database/schema.sql
-- Demonstrating 3NF Normalization, Constraints, and Indexing

-- 1. Core Dimension Table
CREATE TABLE students (
    student_id VARCHAR(50) PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    batch VARCHAR(10) NOT NULL,
    fcm_token TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 2. Fact Table (Transactional Data)
CREATE TABLE attendance_logs (
    log_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    student_id VARCHAR(50) REFERENCES students(student_id) ON DELETE CASCADE,
    cgip_attended INT DEFAULT 0,
    cd_attended INT DEFAULT 0,
    ieft_attended INT DEFAULT 0,
    last_synced TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    
    -- Idempotency constraint: Prevent duplicate daily logs per student
    CONSTRAINT unique_daily_sync UNIQUE (student_id, last_synced::date)
);

-- 3. Analytics / Staging Table (For ML Engine)
CREATE TABLE analytics_staging (
    staging_id UUID PRIMARY KEY,
    student_id VARCHAR(50) REFERENCES students(student_id),
    overall_attendance_pct DECIMAL(5,2),
    active_backlogs INT,
    ml_risk_score VARCHAR(10),
    processed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- ==========================================
-- QUERY OPTIMIZATION: B-Tree & Composite Indexes
-- ==========================================
-- Optimizes the specific dashboard query fetching a student's attendance history
CREATE INDEX idx_student_attendance ON attendance_logs(student_id, last_synced DESC);

-- Optimizes the cron-job query searching for unnotified assignments
CREATE INDEX idx_pending_notifications ON pending_assignments(due_date) WHERE notification_sent = false;
