#Project Translation

This plugin is to help devs syncing multiple poFiles to google sheet.

## Installation
In your plugin/theme
```
npm install --save-dev mars-technology/project-translation
```

## Usage
Run the command below to sync translations. Normally we will run this command twice.
1. First time : scan for new translation from source, we sync. 
2. Second time : After we have translated them in google sheet, we sync again.
```
node node_modules/project-translation/index.js
```

## Requirements
This command above will guide you through to get all the requirements, below is just the recap of what you need.
- GOOGLE_APPLICATION_CREDENTIALS - [guide](https://www.notion.so/Project-Translation-8e7782be6bb14f3c9cd0b439f8c9e25d#46d320062dda41e382e4e7fa9794a754)
- wp-cli - [guide](https://www.notion.so/Project-Translation-8e7782be6bb14f3c9cd0b439f8c9e25d#93527793d3b849a5a9e2944b722f56b4)
- gettext - [guide](https://www.notion.so/Project-Translation-8e7782be6bb14f3c9cd0b439f8c9e25d#f3de325b420a44c49f9f86c26cd75fb7)
- translation.config.json
```
//example translation.config.json
{
    "googlSheetUrl" : "https://docs.google.com/spreadsheets/d/xxxxxxxxxxxxxxxxxxxx/edit#gid=1259558084",
    "languages" : [
        "en_GB",
        "fr_CA"
    ],
    "domain" : "safe-wp-blocks"
}
```

## Behind the scene
When you execute the index.js, it runs the following processes:
1. Look for translation.config.json in the current directory and get the config
2. Scan your source code for translations, make the pot file
3. Make/update po file for each language from pot file
4. Connect to google sheet and make po file for each language from the sheet
5. Merge both po file from sheet and po file from pot
6. Compile po files to mo files