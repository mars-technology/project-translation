const clientId = '734510500799-0u0fq3p1mjvdqsrpvq8js4bmkkf734na.apps.googleusercontent.com';//process.env.GOOGLE_OAUTH_CLIENT_ID, //734510500799-0u0fq3p1mjvdqsrpvq8js4bmkkf734na.apps.googleusercontent.com
const clientSecret = 'UvkCBwETqrOep3hq9nRURBxU';//process.env.GOOGLE_OAUTH_CLIENT_SECRET //UvkCBwETqrOep3hq9nRURBxU

const {OAuth2Client} = require('google-auth-library');
const http = require('http');
const url = require('url');
const destroyer = require('server-destroy');
const PO = require('pofile');

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
                throw Error('Item "' + item.msgid + '" does not exist in target PO file.');
            }
            if (targetItem.msgid_plural !== item.msgid_plural)
            {
                throw Error('msgid_plural mismatch for "' + item.msgid + '"');
            }
            targetItem.msgstr = item.msgstr;
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

    for (i = 0 ; 'msgstr[' + i + ']' in row ; i += 1)
    {
        item.msgstr[i] = row['msgstr[' + i + ']'];
        if (i && item.msgstr[i])
        {
            plural = true;
        }
    }
    if (! plural)
    {
        item.msgstr = [ item.msgstr[0] ];
    }

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
    const doc = new GoogleSpreadsheet(googleSheetId);
    // Initialize Auth - see more available options at https://theoephraim.github.io/node-google-spreadsheet/#/getting-started/authentication
    await doc.useOAuth2Client(oAuth2Client);
    await doc.loadInfo(); // loads document properties and worksheets
    for (let i = 0; i < doc.sheetsByIndex.length; i++) {
        const sheet = doc.sheetsByIndex[0];
        if (!langList[sheet.title]) {
            continue ;
        }
        const poFile = await loadPoFileFromSheet(sheet)
        langList[sheet.title].poFiles.push(poFile);
    }
}

function getConfig() {
    return new Promise(resolve => {
        let config = {};
        var fs = require('fs');
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
    const config = await getConfig();

    const langList = {};
    for (const poFilePath of config.poFilePaths) {
        const poFile = await loadPoFileFromPath(poFilePath);
        langList[poFile.headers.Language] = {
            path: poFilePath,
            poFiles: [poFile]
        };
    }

    await loadPoFilesFromSheet(langList, config);

    for (const lang in langList) {
        if (langList.hasOwnProperty(lang)) {
            const translatedPo = await mergeIntoPo(langList[lang].poFiles);
        }
    }
}

main().catch(console.error);
