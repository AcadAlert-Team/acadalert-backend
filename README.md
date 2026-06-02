# ⚙️ AcadAlert: Core Backend API

This repository contains the Node.js/Express backend and Firebase notification engine for the **AcadAlert** microservice architecture. 

**This is a sub-repository.** For the full system architecture, live demo video, and frontend React Native code, please visit the main repository:
👉 **[INSERT LINK TO YOUR MOBILE REPO HERE]**

### 🏗️ Microservice Responsibilities
* **Database Routing:** Interfaces with Supabase PostgreSQL to handle all student and faculty data transactions.
* **Automated Daemon:** Runs a `node-cron` job that scans for pending assignments and calculates dynamic deadlines.
* **Notification Deduplication:** Intercepts overlapping database triggers and utilizes memory-bank validation to guarantee a single Firebase Cloud Messaging (FCM) push payload per physical device.

### Tech Stack
* Node.js, Express.js, Supabase JS Client, Firebase Admin SDK, node-cron