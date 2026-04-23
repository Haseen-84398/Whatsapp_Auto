# Cee Vision Technologies - WhatsApp AI Bot 🤖

A complete, AI-powered WhatsApp Bot designed to automate group creation, document distribution, and assessment evidence tracking for Cee Vision Technologies.

---

## 🌟 Key Features

1. **Auto Group Creation (Google Sheets)**
    - Automatically reads pending assessments from a Google Sheet every 5 minutes.
    - **New Connectivity**: Uses a Google Apps Script Bridge for 100% stable connection (No more OAuth login or Token expiry issues).
    - Creates WhatsApp groups and adds necessary members and admins.
    - Automatically distributes SSC-specific guidelines and PDF documents upon group creation.

2. **Smart Member Management (NLP Powered)**
    - **Add**: Type `!add 9876543210` or naturally say `"isko add kardo 9876543210"`.
    - **Remove**: Type `!remove @User` or naturally say `"remove 9876543210"`.
    - **Complete Exit**: Type `complete exit` followed by `confirm exit` to remove all members and delete the group.

3. **AI Vision & Photo Verification (Gemini 2.0 Flash)**
    - Analyzes photos uploaded to the group to determine if they are Aadhaar Cards, Group Photos, Theory Photos, etc.
    - Automatically checks photo quality. If a photo is blurry or too dark, the bot sends a warning: `⚠️ Photo Quality Issue`.

4. **Evidence Tracking System**
    - Tracks incoming evidence categories for each group.
    - Command `!evidence` shows exactly what is collected (✅) and what is missing (❌).

5. **Daily Analytics Reporting**
    - Automatically sends a daily report at 10 PM IST to the bot's own number.
    - Command `!report` instantly shows groups created, media saved, and photos verified today.

6. **Custom Media Categorization**
    - Command `!mode aadhar` forces the bot to save all incoming photos as Aadhaar.
    - Command `!document Attendance` saves all incoming PDFs with custom prefixes.

---

## 🛠️ Setup & Deployment

### Google Sheets Integration (The "Stable" Way)
The bot now uses a **Google Apps Script Web App** to talk to Google Sheets. This avoids all the complex Google Cloud permission issues.

1.  **Apps Script Setup**: The code for the Apps Script is in the Google Sheet (Extensions > Apps Script).
2.  **Connectivity**: The bot uses the `SCRIPT_URL` defined in `src/sheets.js` to fetch and update data.
3.  **No JSON Required**: You no longer need `service-account.json` in the root folder.

### Installation Steps
1.  **Node.js**: Install Node.js (v18+).
2.  **Dependencies**: Run `install_dependencies.bat`.
3.  **Run**: Run `RunBot.bat` and scan the QR code.

---

## 📁 Project Structure

-   `src/index.js`: Main bot logic and WhatsApp connection.
-   `src/sheets.js`: **[UPDATED]** Handles all Google Sheets communication via Apps Script URL.
-   `src/ssc_documents/`: Folder for PDF guidelines.
-   `tests/`: **[NEW]** Contains all testing scripts (e.g., `test_sheets.js` to verify connection).
-   `downloads/`: Media and documents saved from WhatsApp groups.

---

## 📜 Command List

| Command                         | Action                                      | Where to use? |
| :------------------------------ | :------------------------------------------ | :------------ |
| **`!add [number]`**             | Adds a member and sends guidelines.         | In Group      |
| **`!remove [number]`**          | Removes a member.                           | In Group      |
| **`complete exit`**             | Triggers group deletion warning.            | In Group      |
| **`confirm exit`**              | Removes everyone and leaves group.          | In Group      |
| **`!evidence`**                 | Shows missing & collected photos.           | In Group      |
| **`!report`**                   | Shows today's bot statistics.               | Anywhere      |
| **`!creategroup Name\|Number`** | Manually creates a group.                   | Anywhere      |
| **`!mode [category]`**          | Forces media to save under a specific name. | In Group      |
| **`!document [name]`**          | Forces PDFs to save under a specific name.  | In Group      |

---

_Updated: 23-Apr-2026 | Connection Mode: Apps Script Bridge_
