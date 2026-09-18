# ⚙️ AcadAlert: Core Backend API

This repository contains the Node.js/Express backend and Firebase notification engine for the **AcadAlert** microservice architecture. 

**This is a sub-repository.** For the full system architecture, live demo video, and frontend React Native code, please visit the main repository:
👉 **[LINK TO MOBILE REPO HERE](https://github.com/AcadAlert-Team/acadalert-mobile)**

## 🏗️ Microservice Responsibilities

* **Database Routing:** Interfaces with Supabase PostgreSQL to handle all student and faculty data transactions.
* **Automated Daemon:** Runs a node-cron job managed continuously by **PM2** that scans for pending assignments and calculates dynamic deadlines.
* **Notification Deduplication:** Intercepts overlapping database triggers and utilizes memory-bank validation to guarantee a single Firebase Cloud Messaging (FCM) push payload per physical device.
* **Secure Cloud Archiving:** Utilizes the AWS SDK and **IAM Roles** for credential-less, automated JSON log backups directly to **AWS S3**.

## 🛠️ Tech Stack
Node.js, Express.js, Supabase JS Client, Firebase Admin SDK, node-cron, AWS SDK (S3), PM2


<<<<<<< HEAD
### 📊 Data Engineering Architecture
* **Strict 3NF Schema & Indexing:** A well-documented PostgreSQL schema (`database/schema.sql`) enforcing 3rd Normal Form (3NF), uniqueness constraints, and optimized composite B-Tree indexes for fast read operations.
* **Idempotent Data Ingestion:** Utilizes `UPSERT` operations to ensure absolute pipeline idempotency, preventing duplicate records during network retries or overlapping webhook triggers.
* **Dead Letter Queue (DLQ):** Implements fault tolerance in the notification engine. Failed push notification tasks are intercepted and routed to a dedicated DLQ table (`dlq_failed_notifications`) for robust automated retries instead of failing silently.

### Tech Stack
* Node.js, Express.js, Supabase JS Client, Firebase Admin SDK, node-cron
=======
>>>>>>> 888dfc9fe6b01f368ffbe7b6335f7fbb20f07dc7
