# WhatsApp Automation Bot - Documentation

This document provides a clear and simple overview of all the features and capabilities currently built into the WhatsApp Automation Bot.

## 🚀 Core Features

### 1. Automated Group Creation (Google Sheets Sync)

- **Auto-Sync:** The bot automatically checks the connected Google Sheet ("Assessment Tracker") every 5 minutes for new rows marked as "Pending".
- **Status Updates:** When creating a group, it updates the sheet status to "Creating..." to prevent duplicate creations, and marks it as "Created" once successfully done.
- **Manual Sync:** You can manually trigger a sheet sync at any time by sending the `!sync` command to the bot in WhatsApp.

### 2. Manual Group Creation

- **Command:** `!creategroup [Group Name] | [Number1], [Number2]`
- Allows you to instantly create a new group directly from a WhatsApp chat.
- The bot automatically adds your pre-defined "Main Team" members to every new group along with the numbers you provide in the command.

### 3. Automated Guidelines & Document Sending

- The bot smartly reads the Group Name. Depending on the batch type (e.g., SCGJ, HCSSC, CSDCI, MESC, GJSCI, or PM-Vishwakarma), it automatically sends the correct guidelines text.
- Immediately after sending the text, it uploads all required PDF documents (Feedback Forms, Assessment Plans, Declarations, etc.) directly into the newly created group.

### 4. Media & Chat Backup System

- **Chat Logs:** Every text message sent to the bot (or in groups where the bot is added) is saved locally in organized text files categorized by date and group name.
- **Media Downloader:** All images, videos, audio, and documents are automatically downloaded and saved into organized folders on your computer system.

### 5. Smart File Renaming Modes

You can tell the bot how to name incoming files to keep your evidence organized:

- **Command:** `!mode [type]` (Available options: `aadhar`, `group`, `theory`, `practical`, `viva`, `stop`). Once a mode is active, all incoming photos/videos will be saved with that name and a number (e.g., Aadhar_Holding_1.jpg).
- **Custom Documents:** `!document [Name]` will save the next incoming files with that specific name.
- **Interactive Renaming:** If an uncategorized file is sent, the bot replies asking you to categorize it by replying with a number (1 to 6).

### 6. On-Demand File Requests

- **Command:** `!need [file name]` (e.g., `!need vtp`)
- The bot searches its local folders for the requested form or document and instantly sends it back in the chat.
- **Command:** `!paper [language]` (e.g., `!paper hindi`)
- Specifically designed for PM-Vishwakarma batches, it fetches the correct language question paper based on whether the group is "Day 0" or "Day 6".

### 7. Auto-Admin Promotion

- Certain critical team members (like main operations numbers) are automatically promoted to Group Admins as soon as the group is created.

### 8. Anti-Ban & Safety Systems

- **Daily Limits:** To keep the WhatsApp account safe, the bot limits group creation to a maximum of 10 groups per day.
- **Cooldowns:** It deliberately waits 3 minutes between creating each group to avoid rate-limiting or getting banned by WhatsApp.

### 9. Quick Info Commands

- **Command:** `!guidelines` - Re-sends the specific rules and documents for the group it is typed in.
- **Command:** `!address` - Instantly replies with the official company courier address for hard copies.

### 10. Multi-Bot Support & Auto-Update

- **Multi-Bot Prevention:** If multiple bot instances are running, they use a tracking system to ensure a command is only executed once, preventing duplicate actions.
- **Auto-Update:** The bot silently checks GitHub for new code every 6 hours. If an update is found, it automatically restarts, downloads the new changes via `start.bat`, and starts running the new code seamlessly.

---

## 🛠️ Useful Commands

### 🖥️ Terminal & System Commands (PowerShell)

Use these commands to manage the environment and setup:

- **Run the Bot:**
    ```powershell
    .\start.bat
    ```
- **Refresh Terminal PATH (If `node` or `gcloud` not found):**
    ```powershell
    $env:PATH = [System.Environment]::GetEnvironmentVariable("PATH","Machine") + ";" + [System.Environment]::GetEnvironmentVariable("PATH","User")
    ```
- **Google Cloud Setup (Run in order):**
    1. Login: `gcloud auth login`
    2. Set Project: `gcloud config set project whatsapp-493623`
    3. Set ADC Login: `gcloud auth application-default login --impersonate-service-account=whatsappboot@whatsapp-493623.iam.gserviceaccount.com`
- **Verify Google Sheets Connection:**
    ```powershell
    node testSheet.js
    ```

### 📱 Bot WhatsApp Commands

Send these commands directly to the bot's WhatsApp number or inside groups:

| Command                      | Description                                                       |
| :--------------------------- | :---------------------------------------------------------------- |
| `!sync`                      | Force check Google Sheet for new groups immediately.              |
| `!creategroup Name \| 91...` | Create a new group manually with specified members.               |
| `!guidelines`                | Send the guidelines and forms for the current group.              |
| `!need [filename]`           | Ask the bot to send a specific form from its folder.              |
| `!paper [language]`          | Send a specific question paper (e.g., Hindi/English).             |
| `!address`                   | Get the official courier address for document submission.         |
| `!mode [type]`               | Set renaming mode (aadhar, group, theory, practical, viva, stop). |
| `!document [name]`           | Set a custom name for the next document sent to the bot.          |
