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

### Tech Stack
* Node.js, Express.js, Supabase JS Client, Firebase Admin SDK, node-cron
