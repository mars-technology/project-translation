#!/usr/bin/env node
const path = require('path');
const PO = require('pofile');
let doc;
const fs = require('fs');
const { exec } = require("child_process");

const POT_FILENAME = "translation.pot";

(function() {
    let config = null;
    let langList = {};
    let potFilePath = "";
    function getIdFromUrl(url) {
        if (!url || (typeof url) !== "string") {
            return false;
        }
        let matches = url.match('spreadsheets/d/([a-zA-Z0-9-_]+)');
        if (matches && matches.length === 2) {
            return matches[1];
        }
        else {
            return false;
        }
    }

    function loadPoFileFromPath (poFilePath)
    {
        return new Promise(function (resolve) {
            PO.load(poFilePath, function (error, poData) {
                if (error)
                {
                    throw error;
                }
                if (poData.headers['Plural-Forms'])
                {
                    poData.nplurals = (
                        ( poData.headers['Plural-Forms'] || '' )
                            .match(/nplurals\s*=\s*([0-9])/) || [,1]
                    )[1];
                }
                else
                {
                    poData.nplurals = Math.max.apply(undefined,
                        poData.items.map(function (item) {
                            return item.msgstr.length;
                        })
                    );
                }
                resolve(poData);
            });
        });
    }

    function splitIntoLines (string)
    {
        if (!string) {
            return [];
        }
        return string.trim().split('\n').filter(function (line) {
            return line !== '';
        });
    }

    function mergeIntoPo (targetPo, sheetPo)
    {
        var targetItemsByMsgId = {};
        targetPo.items.forEach(function (item) {
            targetItemsByMsgId[item.msgid] = item;
            if (item.msgid.trim() !== item.msgid) { //if msgid has trailing space, we need to make sure the msgid that got trimmed by google sheet matches the key
                const msgidWithTrailingSpace = item.msgid;
                for (const data of sheetPo) {
                    const itemFromSheet = data.find(itemFromSheet => itemFromSheet.msgid === msgidWithTrailingSpace.trim())
                    if (itemFromSheet) {
                        itemFromSheet.msgid = msgidWithTrailingSpace;
                    }
                }
            }
        });
        if (!sheetPo) {
            return ;
        }

        sheetPo.forEach(function (item) {
            var targetItem = targetItemsByMsgId[item.msgid];
            if (! targetItem)
            {
                console.log('Item "' + item.msgid + '" does not exist in target PO file.');
                return ;
            }
            if (targetItem.msgid_plural !== item.msgid_plural)
            {
                throw Error('msgid_plural mismatch for "' + item.msgid + '"');
            }
            targetItem.msgstr = [ item.msgstr ];
            targetItem.flags  = item.flags;
        });
    }

    function transformRowToPoItem (row)
    {
        var i;
        var item = new PO.Item();
        var plural = false;

        item.msgid             = row.msgid             || item.msgid;
        item.msgid_plural      = row.msgid_plural      || item.msgid_plural;
        item.references        = splitIntoLines(row.references)        || item.references;
        item.extractedComments = splitIntoLines(row.extractedComments) || item.extractedComments;
        splitIntoLines(row.flags).forEach(function (flag) {
            item.flags[flag] = true;
        });
        item.msgstr = row.msgstr;
        return item;
    }

    async function loadPoFileFromSheet(sheet) {
        const rows = await sheet.getRows();
        return Promise.resolve(rows.map(transformRowToPoItem));
    }

    async function getPoFilesFromSheet() {
        const googleSheetId = getIdFromUrl(config.googlSheetUrl);
        if (!googleSheetId) {
            console.log("Invalid googleSheetUrl");
            process.exit();
        }
        const { GoogleSpreadsheet } = require('google-spreadsheet');
        // Initialize the sheet - doc ID is the long id in the sheets URL
        doc = new GoogleSpreadsheet(googleSheetId);
        // Initialize Auth - see more available options at https://theoephraim.github.io/node-google-spreadsheet/#/getting-started/authentication
        const credentials = require(process.env.GOOGLE_APPLICATION_CREDENTIALS);
        await doc.useServiceAccountAuth(credentials);
        try {
            await doc.loadInfo(); // loads document properties and worksheets
        } catch (e) {
            console.error(`This sheet is not editable by this service account, please add \x1b[36m${credentials.client_email}\x1b[0m as an editor in the sheet's sharing setting.`);
            process.exit();
        }
        for (let i = 0; i < doc.sheetsByIndex.length; i++) {
            const sheet = doc.sheetsByIndex[i];
            if (!langList[sheet.title]) {
                continue ;
            }
            const poFile = await loadPoFileFromSheet(sheet)
            langList[sheet.title].sheetPo = poFile;
            langList[sheet.title].sheet = sheet;
        }
    }

    function getConfig() {
        return new Promise(resolve => {
            try {
                config = JSON.parse(fs.readFileSync('translation.config.json', 'utf8'));
                if (!config.googlSheetUrl) {
                    throw Error("googleSheetUrl is not specified");
                }
                if (!config.outputDir) {
                    config.outputDir = "./languages";
                }
                if (!config.languages || config.languages.length === 0) {
                    throw Error("languages is not specified");
                }
                if (!config.domain) {
                    throw Error("domain is not specified");
                }
            } catch (e) {
                console.error(e.message);
                console.log("translation.config.json is not found/invalid, please create one like below:")
                console.log(`
    {
        "googlSheetUrl" : "https://docs.google.com/spreadsheets/d/xxxxxxxxxxxxxxxxxxxx/edit#gid=1259558084",
        "languages" : [
            "en_GB",
            ["fr_CA", "fr_BE", "fr_MA"], //if array is given, first lang will be synced to sheet, the others will take first's translations
            "pt_PT",
            "pt_BR",
        ],
        "domain" : "safe-wp-blocks"
    }
            `);
                process.exit();
            }
            resolve();
        });
    }

    async function getPOT() {
        potFilePath = path.join(config.outputDir, POT_FILENAME);
        try {
            await new Promise(resolve => {
                exec(`wp i18n make-pot . ${potFilePath} --exclude=\"vendor,node_modules,static,public,build\" --domain=${config.domain}`, function(error, stdout, stderr) {
                    if (error) {
                        console.error(error.message);
                        process.exit();
                    }
                    resolve();
                });
            });
        } catch(e) {
            console.error(e.message)
        }
    }

    async function getPO(mayBeLocaleArray) {
        let locales;
        if (Array.isArray(mayBeLocaleArray)) {
            locales = mayBeLocaleArray;
        } else {
            locales = [mayBeLocaleArray];
        }
        let reference = config.domain + "-" + locales[0];
        for (const locale of locales) {
            const poFilePath = path.join(config.outputDir, config.domain + "-" + locale + '.po');
            let cmd = `msginit --locale ${locale} --input ${potFilePath} --output ${poFilePath}`;
            if (fs.existsSync(poFilePath)) {
                cmd = `msgmerge --update ${poFilePath} ${potFilePath}`
            }
            await new Promise(resolve => {
                exec(cmd, function(error, stdout, stderr) {
                    if (error) {
                        console.error(error.message);
                        process.exit();
                    }
                    resolve();
                });
            });
            const poFile = await loadPoFileFromPath(poFilePath);
            langList[config.domain + "-" + locale] = {
                path: poFilePath,
                potPo: poFile,
                reference,
            };
        }
    }

    async function sync() {
        for (const lang in langList) {
            if (langList.hasOwnProperty(lang)) {
                mergeIntoPo(langList[lang].potPo, langList[langList[lang].reference].sheetPo);
                if (langList[lang].potPo.items.length === 0) {
                    continue ;
                }
                try {
                    fs.writeFileSync(langList[lang].path, '' + langList[lang].potPo + '\n')
                    if (langList[lang].reference !== lang) { //skip sync to sheet if it's not a `reference` language
                        console.log(' \x1b[32m' + lang + ".po done." + '\x1b[0m');
                        continue ;
                    }
                    let oldSheet = langList[lang].sheet;
                    if (oldSheet) {
                        await oldSheet.updateProperties({
                            title: lang + "_old",
                        })
                    }
                    const newSheet = await doc.addSheet({
                        title: lang,
                        headerValues: Object.keys(langList[lang].potPo.items[0])
                    });
                    await newSheet.addRows(langList[lang].potPo.items.map(item => {
                        item.flags = Object.keys(item.flags).join(', ');
                        item.extractedComments = item.extractedComments.join('\n');
                        item.references = item.references.join('\n');
                        item.comments = item.comments.join('\n');
                        item.msgstr = item.msgstr.join('\n');
                        return item;
                    }));
                    if (oldSheet) {
                        await oldSheet.delete();
                    }

                    console.log(' \x1b[32m' + lang + ".po done." + '\x1b[0m');
                } catch (e) {
                    console.log(e.message);
                    process.exit();
                }

            }
        }
    }

    async function checkLocalHasWpCliAndGettext() {
        await new Promise(resolve => {
            exec("whereis msginit", function(error, stdout, stderr) {
                if (!stdout.split(":")[1].trim()) {
                    console.error("`whereis msginit` could not find msginit. Please install gettext in your local.");
                    console.error("https://www.drupal.org/docs/8/modules/potion/how-to-install-setup-gettext");
                    process.exit();
                }
                resolve();
            });
        });
        await new Promise(resolve => {
            exec("whereis wp", function(error, stdout, stderr) {
                if (!stdout.split(":")[1].trim()) {
                    console.error("`whereis wp` could not find wp. Please install wp-cli in your local. It is normally installed by composer.");
                    console.error("https://make.wordpress.org/cli/handbook/guides/installing/#installing-via-composer");
                    console.error("make sure wp command is executable, `export PATH=${PATH}:PATH_TO_WP_CLI_BIN_DIR`");
                    process.exit();
                }
                resolve();
            });
        });
    }

    function checkGoogleServiceAccount() {
        if (!process.env.GOOGLE_APPLICATION_CREDENTIALS || !fs.existsSync(process.env.GOOGLE_APPLICATION_CREDENTIALS)) {
            console.log("Please specify the path to the service account credential json in GOOGLE_APPLICATION_CREDENTIALS");
            console.log("https://cloud.google.com/docs/authentication/getting-started#auth-cloud-implicit-nodejs");
            process.exit();
        }
    }

    async function compile() {
        for (const lang in langList) {
            if (langList.hasOwnProperty(lang)) {
                const pathPrefix = path.join(config.outputDir, lang);
                await new Promise(resolve => {
                    exec(`msgfmt ${pathPrefix + ".po"} --output-file=${pathPrefix + ".mo"}`, function(error, stdout, stderr) {
                        if (error) {
                            console.error(error.message);
                            process.exit();
                        }
                        resolve();
                    });
                });
                console.log(' \x1b[32m' + lang + ".mo done." + '\x1b[0m');
            }
        }
    }

    async function main() {
        checkGoogleServiceAccount();
        await checkLocalHasWpCliAndGettext();
        console.log('\x1b[36m', '1. Loading translation.config.json', '\x1b[0m');
        await getConfig();
        console.log('\x1b[32m', "loaded translation.config.json", '\x1b[0m');
        console.log('\x1b[36m', "2. Updating new translations from source", '\x1b[0m');
        await getPOT();
        for (const language of config.languages) {
           await getPO(language);
        }
        console.log('\x1b[32m', "translations are updated", '\x1b[0m');
        console.log('\x1b[36m', "3. Authenticating", '\x1b[0m');
        await getPoFilesFromSheet();
        console.log('\x1b[32m', 'authenticated', '\x1b[0m');
        console.log('\x1b[36m', "4. Syncing", '\x1b[0m');
        await sync();
        console.log('\x1b[32m', "synced", '\x1b[0m');
        console.log('\x1b[36m', "5. Compiling", '\x1b[0m');
        await compile();
        console.log('\x1b[32m', "compiled", '\x1b[0m');
        console.log('\x1b[36m', "--- FINISH ---", '\x1b[0m');
    }
    main().catch(console.error);
})();


