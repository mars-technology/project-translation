#!/usr/bin/env node
const clientId = process.env.GOOGLE_API_BROWSER_CLIENT_ID
const clientSecret = process.env.GOOGLE_API_SECRET_KEY
const {OAuth2Client} = require('google-auth-library');
const http = require('http');
const url = require('url');
const destroyer = require('server-destroy');
const PO = require('pofile');
let doc;
const fs = require('fs');

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

function getAuthenticatedClient(oAuth2Client) {
    return new Promise((resolve, reject) => {
        // create an oAuth client to authorize the API call.  Secrets are kept in a `keys.json` file,
        // which should be downloaded from the Google Developers Console.


        // Generate the url that will be used for the consent dialog.
        const authorizeUrl = oAuth2Client.generateAuthUrl({
            access_type: 'offline',
            scope: 'https://www.googleapis.com/auth/spreadsheets',
        });

        // Open an http server to accept the oauth callback. In this simple example, the
        // only request to our webserver is to /oauth2callback?code=<code>
        const server = http
            .createServer(async (req, res) => {
                try {
                    if (req.url.indexOf('?code') > -1) {
                        // acquire the code from the querystring, and close the web server.
                        const qs = new url.URL(req.url, 'http://localhost:3000')
                            .searchParams;
                        const code = qs.get('code');
                        res.end('Authentication successful! Please return to the console.');
                        server.destroy();
                        // Now that we have the code, use that to acquire tokens.
                        const r = await oAuth2Client.getToken(code);
                        // Make sure to set the credentials on the OAuth2 client.
                        oAuth2Client.setCredentials(r.tokens);
                        resolve(oAuth2Client);
                    }
                } catch (e) {
                    reject(e);
                }
            })
            .listen(3000, () => {
                console.log("Please go to " + authorizeUrl + "\n");
                console.log("localhost:3000 must be available for this to work, if you could not make it available, you can copy the [code] from redirected url parameter, and rerun the command `node index.js [code]`, this code only work once.")
            });
        destroyer(server);
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

function mergeIntoPo (datas)
{
    var target = datas.shift();
    var targetItemsByMsgId = {};
    target.items.forEach(function (item) {
        targetItemsByMsgId[item.msgid] = item;
        if (item.msgid.trim() !== item.msgid) { //if msgid has trailing space, we need to make sure the msgid that got trimmed by google sheet matches the key
            const msgidWithTrailingSpace = item.msgid;
            for (const data of datas) {
                const itemFromSheet = data.find(itemFromSheet => itemFromSheet.msgid === msgidWithTrailingSpace.trim())
                if (itemFromSheet) {
                    itemFromSheet.msgid = msgidWithTrailingSpace;
                }
            }
        }
    });

    datas.forEach(function (itemsToMerge) {
        itemsToMerge.forEach(function (item) {
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
    });

    return Promise.resolve(target);
}

function writePoOutput (poData)
{
    try
    {
        process.stdout.write('' + poData + '\n');
    }
    catch (e) { throw e; }
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

async function loadPoFilesFromSheet(langList, config) {

    const googleSheetId = getIdFromUrl(config.googlSheetUrl);
    if (!googleSheetId) {
        console.log("Invalid googleSheetUrl");
        process.exit();
    }
    const oAuth2Client = new OAuth2Client(
        clientId,
        clientSecret,
        "http://localhost:3000"
    );
    if (process.argv.length >= 3) {
        const code = decodeURIComponent(process.argv[2]);
        try {
            const r = await oAuth2Client.getToken(code);
            // Make sure to set the credentials on the OAuth2 client.
            oAuth2Client.setCredentials(r.tokens);
        } catch(e) {
            console.log("Invalid Code : Code only works once, you must repeat the copy-paste process or make localhost:3000 available");
            process.exit();
        }

    } else {
        await getAuthenticatedClient(oAuth2Client);
    }
    const { GoogleSpreadsheet } = require('google-spreadsheet');
    // Initialize the sheet - doc ID is the long id in the sheets URL
    doc = new GoogleSpreadsheet(googleSheetId);
    // Initialize Auth - see more available options at https://theoephraim.github.io/node-google-spreadsheet/#/getting-started/authentication
    await doc.useOAuth2Client(oAuth2Client);
    await doc.loadInfo(); // loads document properties and worksheets
    for (let i = 0; i < doc.sheetsByIndex.length; i++) {
        const sheet = doc.sheetsByIndex[i];
        if (!langList[sheet.title]) {
            continue ;
        }
        const poFile = await loadPoFileFromSheet(sheet)
        langList[sheet.title].poFiles.push(poFile);
        langList[sheet.title].sheet = sheet;
    }
}

function getConfig() {
    return new Promise(resolve => {
        let config = {};
        try {
            config = JSON.parse(fs.readFileSync('translation.config.json', 'utf8'));
        } catch (e) {
            console.log(e.message);
            console.log("translation.config.json is not found, please create one like below:")
            console.log(`
                    {
                        "googlSheetUrl" : "https://docs.google.com/spreadsheets/d/1p4znB6wKhElVpSAJzxPzXKbU85i9Pvbl4xL5YbHGzBU/edit#gid=1259558084",
                        "poFilePaths" : [
                            "en_GB.po",
                            "fr_CA.po",
                        ]
                    }
            `);
            process.exit();
        }
        resolve(config);
    });
}

async function main() {
    if (!clientId) {
        console.log("ENV does not have GOOGLE_API_BROWSER_CLIENT_ID specified.");
        process.exit();
    }
    if (!clientSecret) {
        console.log("ENV does not have GOOGLE_API_SECRET_KEY specified.");
        process.exit();
    }
    console.log("1. Loading translation.config.json")
    const config = await getConfig();
    console.log('\x1b[36m%s\x1b[0m', "loaded translation.config.json\n");  //cyan
    console.log("2. Loading po files")
    const langList = {};
    for (const poFilePath of config.poFilePaths) {
        const poFile = await loadPoFileFromPath(poFilePath);
        langList[poFile.headers.Language] = {
            path: poFilePath,
            poFiles: [poFile]
        };
    }
    console.log('\x1b[36m%s\x1b[0m', "loaded po files\n")
    console.log("3. Authenticating")
    await loadPoFilesFromSheet(langList, config);
    console.log('\x1b[36m%s\x1b[0m', "authenticated\n");
    console.log("4. Syncing");
    for (const lang in langList) {
        if (langList.hasOwnProperty(lang)) {
            const translatedPo = await mergeIntoPo(langList[lang].poFiles);
            if (translatedPo.items.length === 0) {
                continue ;
            }
            try {
                fs.writeFileSync(langList[lang].path, '' + translatedPo + '\n')
                let oldSheet = langList[lang].sheet;
                if (oldSheet) {
                    await oldSheet.updateProperties({
                        title: lang + "_old",
                    })
                }
                const newSheet = await doc.addSheet({
                    title: lang,
                    headerValues: Object.keys(translatedPo.items[0])
                });
                await newSheet.addRows(translatedPo.items.map(item => {
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

                console.log('\x1b[36m%s\x1b[0m', lang + " done.");
            } catch (e) {
                console.log(e.message);
                process.exit();
            }

        }
    }
}

main().catch(console.error);
