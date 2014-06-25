var http = require('http')
    , WebSocket = require('ws')
    , WebSocketServer = require('ws').Server
    , fs = require('fs')
    , path = require('path')
    , uuid = require('uuid')
    , client = fs.readFileSync(path.join(__dirname, 'client.js'), 'utf8')
    , index = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');

var jsUrlRegEx = /^\/js\/([a-z0-9]{3,})$/i;
var jslessUrlRegEx = /^\/([a-z0-9]{3,})$/i;
var idEncoding = "0123456789abcdefghijklmnopqrstuvwz";
var idEncodingMax = idEncoding.length;

var sessions = {};

var server = http.createServer(function (req, res) {
    if (req.method == 'GET') {
        if (req.url === '/') {
            var id;
            while (!id || sessions[id]) {
                var idraw = new Array(16)
                uuid.v4(null, idraw);
                id = '';
                while (id.length < 5)
                    id += idEncoding[idraw[id.length] % idEncodingMax];
            }

            res.writeHead(302, { 'Location': '/' + id, 'Cache-Control': 'no-cache' });
            return res.end();
        }

        var match = req.url.match(jslessUrlRegEx);
        if (match) {
            var id = match[1].toLowerCase();
            res.writeHead(200, { 'Content-Type': 'text/html', 'Cache-Control': 'no-cache' });
            return res.end(index
                .replace(/\{\{ id \}\}/g, id)
                .replace(/\{\{ hostport \}\}/g, req.headers['host'] || 'repl.mobi'));
        }

        match = req.url.match(jsUrlRegEx);
        if (match) {
            var id = match[1].toLowerCase();
            res.writeHead(200, { 'Content-Type': 'application/javascript', 'Cache-Control': 'no-cache' });
            return res.end(client + "('" + id + "');");
        }
    }

    res.writeHead(404);
    return res.end();

}).listen(process.env.PORT || 8080);

var wss = new WebSocketServer({ server: server });

function kill(socket, status) {
    try {
        socket.write(status);
        socket.destroy();
    }
    catch (e) {}
}

var oldUpgrade = wss.handleUpgrade;
wss.handleUpgrade = function (request, socket, upgradeHead, callback) {
    var match = request.url.match(jslessUrlRegEx);
    if (match) {
        var id = match[1].toLowerCase();
        var protocol = request.headers['sec-websocket-protocol'] || 'client';
        if (protocol !== 'server' && protocol !== 'client') 
            return kill(socket, 'HTTP/1.1 400 Bad Request\r\n\r\n');

        if (protocol === 'client' && sessions[id] && sessions[id][protocol].length > 0) 
            return kill(socket, 'HTTP/1.1 409 Conflict\r\n\r\n');

        return oldUpgrade.call(wss, request, socket, upgradeHead, function (ws) {
            ws._id = id;
            ws._protocol = protocol;
            ws._peerProtocol = protocol === 'server' ? 'client' : 'server';
            callback(ws);
        });
    }

    return kill(socket, 'HTTP/1.1 404 Not Found\r\n\r\n');
};

function sendMessage(ws, session, src, dest, msg, feedback) {
    var needClean;
    session[dest].forEach(function (dest_ws, index) {
        try {
            dest_ws.send(src === 'server' && session[src].length > 1 ? ws._wsid + ': ' + msg : msg);
        }
        catch (e) {
            try {
                dest_ws.close();
            }
            catch (e1) {}

            var dest_ws_desc = dest;
            if (session[dest].length > 1)
                dest_ws_desc += '(' + dest_ws._wsid + ')';
            session[dest][index] = undefined;
            needClean = true;
        
            if (feedback) {
                try {
                    ws.send('ERROR: ' + dest_ws_desc + ' is not reachable: ' + e.toString());
                }
                catch (e2) {
                    try {
                        ws.close();
                    }
                    catch (e3) {}
                    session[src].forEach(function (src_ws, index) {
                        if (src_ws === ws) {
                            session[src][index] = undefined;
                            needClean = true;
                        }
                    });
                }
            }
        }

    });

    if (needClean) 
        cleanSession(session);    
}

function cleanSession(session) {
    clean(session.client);
    clean(session.server);
    if (session.client.length === 0 && session.server.length === 0)
        delete sessions[session.id];

    function clean(wses) {
        var i = 0; 
        while (i < wses.length) {
            if (!wses[i])
                wses.splice(i, 1);
            else
                i++;
        }
    }
}

function onMessage(ws) {
    return function (msg) {
        console.log('RELAY', ws._wsid, ws._protocol, ws._peerProtocol, msg);
        sendMessage(
            ws, 
            ws._session, 
            ws._protocol, 
            ws._peerProtocol, 
            msg, 
            true);
    }
}

function onClose(ws) {
    return function () {
        sendMessage(
            ws, 
            ws._session, 
            ws._protocol, 
            ws._peerProtocol, 
            'CLOSE: ' + ws._protocol + '(' + ws._wsid + ') disconnected.',
            false);
    }
}

wss.on('connection', function(ws) {
    var session = sessions[ws._id];
    if (session) {
        if (ws._protocol === 'client' && session[ws._protocol].length > 0) {
            try {
                ws.send('ERROR: 409 Conflict');
                ws.close();
            }
            catch (e) {}
            return;
        }
    }
    else {
        session = { wsid: 1, id: ws._id, client: [], server: [] };
        sessions[ws._id] = session;
    }

    ws._wsid = session.wsid++;
    session[ws._protocol].push(ws);
    ws._session = session;
    ws.on('message', onMessage(ws));
    ws.on('close', onClose(ws));
    ws.on('error', onClose(ws));

}).on('error', console.log);
