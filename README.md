# Cee Vision Technologies - WhatsApp AI Bot 🤖

A complete, AI-powered WhatsApp Bot designed to automate group creation, document distribution, and assessment evidence tracking for Cee Vision Technologies.

---

## 📜 Update History & Migration (Read this first!)

| Date | Status | Change Description |
| :--- | :--- | :--- |
| **23-Apr-2026** | **Current** | **Migration to Apps Script Bridge**: Removed Direct API/OAuth connection. Switched to a stable Apps Script bridge to bypass Google Cloud's `invalid_grant` and "App Blocked" issues. |
| **Early 2026** | Legacy | **Direct Google Sheets API**: Used Service Accounts and OAuth2. (Now retired due to frequent token expiration and security policy restrictions). |

### 🚀 Why the switch to Apps Script?
Previously, the bot relied on Google's Direct API which required periodic browser logins and complex JSON keys. These often failed due to "Security Policies" or "Expired Tokens". 
The **new method** uses a small script hosted inside your Google Sheet. It's faster, requires **zero manual login**, and never expires.

---

## 🌟 Key Features

1. **Auto Group Creation (Google Sheets)**
    - Automatically reads pending assessments from a Google Sheet every 5 minutes.
    - **Mode**: Stable Apps Script Bridge.
    - Creates WhatsApp groups and adds necessary members and admins.
    - Automatically distributes SSC-specific guidelines upon group creation.

2. **Smart Member Management (NLP Powered)**
    - **Add**: Type `!add 9876543210` or naturally say `"isko add kardo 9876543210"`.
    - **Remove**: Type `!remove @User` or naturally say `"remove 9876543210"`.

3. **AI Vision & Photo Verification (Gemini 2.0 Flash)**
    - Analyzes photos uploaded to the group to determine if they are Aadhaar Cards, Group Photos, etc.
    - Automatically checks photo quality (Blur/Darkness detection).

4. **Evidence Tracking System**
    - Tracks incoming evidence categories for each group.
    - Command `!evidence` shows exactly what is collected (✅) and what is missing (❌).

---

## 🛠️ Setup & Deployment

### Google Sheets Integration
The bot uses the `SCRIPT_URL` defined in `src/sheets.js` to talk to Google Sheets. 

1.  **Apps Script Code**: The code is already pasted in your Google Sheet (Extensions > Apps Script).
2.  **No JSON Required**: You **no longer need** `service-account.json`.
3.  **To Update URL**: If you ever create a new deployment, just replace the URL in `src/sheets.js`.

### How to Auto-Update (on other systems)
If you are moving this to a different computer:
1.  Run **`UpdateBot.bat`**. 
2.  It will automatically pull the latest Apps Script code from GitHub.
3.  Run **`RunBot.bat`** and you're done!

---

## 📁 Project Structure

-   `src/index.js`: Main bot logic and WhatsApp connection.
-   `src/sheets.js`: Updated bridge logic for Google Sheets.
-   `tests/`: Contains `test_sheets.js` to verify connection anytime.
-   `downloads/`: Organized media and documents.

---

## 📜 Command List

| Command                         | Action                                      | Where to use? |
| :------------------------------ | :------------------------------------------ | :------------ |
| **`!add [number]`**             | Adds a member and sends guidelines.         | In Group      |
| **`!remove [number]`**          | Removes a member.                           | In Group      |
| **`!evidence`**                 | Shows missing & collected photos.           | In Group      |
| **`!report`**                   | Shows today's bot statistics.               | Anywhere      |
| **`!creategroup Name\|Number`** | Manually creates a group.                   | Anywhere      |
| **`!mode [category]`**          | Forces media to save under a specific name. | In Group      |

---

_Project Maintenance by: Cee Vision Automation Team_
