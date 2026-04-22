# Google Sheets Connection Setup Guide

Is guide ki madad se aap kisi bhi naye system par Google Sheets ko bot ke saath connect kar sakte hain.

## Step 1: Google Cloud Console Setup
1.  [Google Cloud Console](https://console.cloud.google.com/) par jayein.
2.  Ek naya Project create karein (ya purana select karein).
3.  **APIs & Services > Library** mein jayein aur **"Google Sheets API"** search karke **Enable** karein.
4.  **APIs & Services > Credentials** par click karein.
5.  **Create Credentials > Service Account** par click karein.
6.  Service account ka naam rakhein (e.g., "whatsapp-bot-sheets") aur **Create and Continue** par click karein.
7.  Role select karne ki zaroorat nahi hai, bas **Done** kar dein.

## Step 2: Download JSON Key
1.  Banaye gaye Service Account par click karein.
2.  **Keys** tab mein jayein.
3.  **Add Key > Create new key** par click karein.
4.  **JSON** format select karein aur **Create** dabayein.
5.  Ek `.json` file download hogi. Ise apne project folder mein save karein (e.g., `service-account.json`).

## Step 3: Set Environment Variable (Windows)
Naye system par bot ko batana hoga ki credentials file kahan hai:
1.  Search bar mein **"Edit the system environment variables"** search karein.
2.  **Environment Variables** button par click karein.
3.  **User variables** mein **New** par click karein.
4.  Variable name: `GOOGLE_APPLICATION_CREDENTIALS`
5.  Variable value: Aapki JSON file ka absolute path (e.g., `E:\Whatsapp Bot\service-account.json`).
6.  System ko restart karein ya Terminal ko band karke firse kholein.

## Step 4: Share the Google Sheet
1.  Apni Google Sheet open karein.
2.  **Share** button par click karein.
3.  Apne Service Account ki Email ID (jo JSON file mein `client_email` field mein hai) ko enter karein.
4.  Use **Editor** permission dein aur **Send** kar dein.

## Step 5: Update Code
Apne `src/sheets.js` mein apni Sheet ki ID update karein:
```javascript
const SPREADSHEET_ID = 'AAPKI_SHEET_ID_YAHAN_DAALEIN';
```

---
*Note: Sheet ID aapke browser ke URL bar mein `spreadsheets/d/` aur `/edit` ke beech wala hissa hoti hai.*
