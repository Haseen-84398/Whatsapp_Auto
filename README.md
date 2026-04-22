# Cee Vision Technologies - WhatsApp AI Bot 🤖

A complete, AI-powered WhatsApp Bot designed to automate group creation, document distribution, and assessment evidence tracking for Cee Vision Technologies.

---

## 🌟 Key Features

1. **Auto Group Creation (Google Sheets)**
    - Automatically reads pending assessments from a Google Sheet every 5 minutes.
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

## 🛠️ How to Deploy on a New System

Follow these steps to migrate or install the bot on a brand new Windows machine:

### Step 1: Install Prerequisites

1. Download and install **Node.js** (v18 or higher) from [nodejs.org](https://nodejs.org/).
2. Download and install **Git** (for version control updates) from [git-scm.com](https://git-scm.com/).

### Step 2: Copy the Project Files

Copy the entire `Whatsapp Bot` folder from the old system to the new system.
_Ensure you do NOT copy the `wa_session_data` folder if you want to link a new WhatsApp number._

### Step 3: Install Dependencies

Open the `Whatsapp Bot` folder and double-click the **`install_dependencies.bat`** file.
_This will automatically download all required libraries (Baileys, Axios, Pino, etc.)._

### Step 4: Link WhatsApp

1. Double-click the **`run_bot.bat`** file. A terminal will open.
2. A **QR Code** will appear on the screen.
3. Open WhatsApp on your phone -> Linked Devices -> Link a Device -> Scan the QR code.
4. Once connected, it will say `✅ WhatsApp Connected Successfully!`.

---

## 📁 Project Structure & Configuration

- `src/index.js`: The main brain of the bot. (All commands and AI logic are here).
- `src/docs/` / `src/ssc_documents/`: Place all your PDF guidelines here, sorted by SSC (e.g., CSDCI, MESC, SCGJ).
- `downloads/`: All photos, videos, and documents sent to the bot are saved here, organized by Group Name and Category.
- `wa_session_data/`: Contains WhatsApp login tokens. **(Delete this folder to log out and scan a new QR code).**

### 🔑 Important Configurations (Inside `src/index.js`)

If you need to change API keys or URLs, open `src/index.js` and edit the constants at the top:

- `OPENROUTER_API_KEY`: Your Gemini/OpenRouter API key for Vision AI.
- `SCRIPT_URL`: Your Google Apps Script Web App URL for Google Sheets Auto-Sync.
- `MAX_GROUPS_PER_DAY`: Currently set to 10. Change this to increase daily group creation limits.

---

## 📜 Complete Command List

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

_Maintained by the Cee Vision Technologies Automation Team._
