var http = require('http')
    , WebSocket = require('ws')
    , WebSocketServer = require('ws').Server
    , fs = require('fs')
    , path = require('path')
    , uuid = require('uuid')
    , client = fs.readFileSync(path.join(__dirname, 'client.js'), 'utf8')
    , index = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');

var clientUrlRegEx = /^\/([a-z0-9\-]+)(?:\/|\?|$)/i;

var sessions = {};

var server = http.createServer(function (req, res) {
    if (req.method == 'GET') {
        if (req.url === '/') {
            var id = uuid.v4();
            res.writeHead(200, { 'Content-Type': 'text/html', 'Cache-Control': 'no-cache' });
            return res.end(index
                .replace(/\{\{ id \}\}/g, id)
                .replace(/\{\{ hostport \}\}/g, req.headers['host'] || 'repl.mobi'));
        }

        var match = req.url.match(clientUrlRegEx);
        if (match) {
            var id = match[1].toLowerCase();
            res.writeHead(200, { 'Content-Type': 'application/javascript' });
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
    var match = request.url.match(clientUrlRegEx);
    if (match) {
        var id = match[1].toLowerCase();
        var protocol = request.headers['sec-websocket-protocol'] || 'client';
        if (protocol === 'server' || protocol == 'client') {
            if (sessions[id] && sessions[id][protocol]) {
                return kill(socket, 'HTTP/1.1 409 Conflict\r\n\r\n');
            }

            return oldUpgrade.call(wss, request, socket, upgradeHead, function (ws) {
                ws._id = id;
                ws._protocol = protocol;
                ws._peerProtocol = protocol === 'server' ? 'client' : 'server';
                callback(ws);
            });
        }

        return kill(socket, 'HTTP/1.1 400 Bad Request\r\n\r\n');
    }

    return kill(socket, 'HTTP/1.1 404 Not Found\r\n\r\n');
};

function relay(session, src, dest, msg) {
    console.log('RELAY', src, dest, msg);
    try {
        if (session[dest]) {
            session[dest].send(msg);
        }
    }
    catch (e) {
        try {
            session[dest].close();
        }
        catch (e1) {}
        delete session[dest];
    
        try {
            session[src].send('ERROR: ' + dest + ' is not reachable: ' + e.toString());
        }
        catch (e2) {
            try {
                session[src].close();
            }
            catch (e3) {}
            delete session[src];
            delete sessions[session.id];                
        }
    }
}

function onMessage(ws) {
    return function (msg) {
        return relay(
            ws._session, 
            ws._protocol, 
            ws._peerProtocol, 
            msg); 
    }
}

function onClose(ws) {
    return function () {
        try {
            ws._session[ws._peerProtocol].send('CLOSE: ' + ws._protocol + 'disconnected.');
        }
        catch (e) {
            try {
                ws._session[ws._peerProtocol].close()
            }
            catch (e1) {}
            delete ws._session[ws._peerProtocol];
            delete sessions[ws._session.id];
        }
    }
}

wss.on('connection', function(ws) {
    var session = sessions[ws._id];
    if (session) {
        if (session[ws._protocol]) {
            try {
                ws.send('ERROR: 409 Conflict');
                ws.close();
            }
            catch (e) {}
            return;
        }
    }
    else {
        session = { id: ws._id };
        sessions[ws._id] = session;
    }

    session[ws._protocol] = ws;
    ws._session = session;
    ws.on('message', onMessage(ws));
    ws.on('close', onClose(ws));
    ws.on('error', onClose(ws));

}).on('error', console.log);
