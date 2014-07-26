var http = require('http')
    , WebSocket = require('ws')
    , WebSocketServer = require('ws').Server
    , fs = require('fs')
    , path = require('path')
    , uuid = require('uuid')
    , client = fs.readFileSync(path.join(__dirname, 'client.js'), 'utf8')
    , index = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8')
    , help = fs.readFileSync(path.join(__dirname, 'help.txt'), 'utf8');

var jsUrlRegEx = /^\/js\/([a-z0-9]{3,})$/i;
var jslessUrlRegEx = /^\/([a-z0-9]{3,})\/?(\?json){0,1}$/i;
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
                .replace(/\{\{ hostport \}\}/g, req.headers['host'] || 'repl.ws'));
        }

        match = req.url.match(jsUrlRegEx);
        if (match) {
            var id = match[1].toLowerCase();
            res.writeHead(200, { 'Content-Type': 'application/javascript', 'Cache-Control': 'no-cache' });
            res.write(client);
            return res.end("('" + id + "');");
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

var textFormatters = {
    error: function (ws, msg) {
        return textFormatters.msg(ws, { msg: 'ERROR: ' + msg.msg, from: msg.from });
    },
    disconnected: function (ws, msg) {
        return 'DISCONNECTED: ' + ws._wsid;
    },
    msg: function (ws, msg) {
        return (ws._protocol === 'client' && ws._session.server.length > 1) 
            ? msg.from + ': ' + msg.msg 
            : msg.msg;
    },
    status: function (ws, msg) {
        return 'Connected browsers: ' + msg.browsers + '. Type .h for help.';
    }
};

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
            var json = !!match[2];
            ws._sendFormatted = function (msg) {
                // console.log('SEND', msg);
                if (protocol === 'client' && !json && textFormatters[msg.type]) 
                    return ws.send(textFormatters[msg.type](ws, msg));
                    
                return ws.send(JSON.stringify(msg));
            };
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
            dest_ws._sendFormatted(msg);
        }
        catch (e) {
            try {
                dest_ws.close();
            }
            catch (e1) {}

            session[dest][index] = undefined;
            needClean = true;
        
            if (feedback) {
                try {
                    ws._sendFormatted({
                        type: 'error',
                        code: 404,
                        connection: dest_ws._wsid,
                        msg: 'Connection ' + dest_ws._wsid + ' not reachable',
                        details: e.message || e.toString()
                    });
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

var builtIns = {
    '.help': function (ws) {
        try {
            ws._sendFormatted({ 
                type: 'msg', 
                msg: help 
            });
        }
        catch (e) {}
    },
    '.status': function (ws) {
        try {
            ws._sendFormatted({
                type: 'status',
                browsers: ws._session.server.length
            });
        }
        catch (e) {}
    }
};
builtIns['.h'] = builtIns['.help'];
builtIns['.s'] = builtIns['.status'];

function onMessage(ws) {
    return function (msg) {
        if (typeof msg === 'string' && builtIns[msg]) 
            builtIns[msg](ws);
        else {
            if (ws._protocol === 'client')
                msg = { type: 'msg', msg: msg };
            else {
                try {
                    msg = JSON.parse(msg);
                }
                catch (e) {
                    msg = { type: 'error', code: 400, msg: e.message || e.toString() };
                }
                msg.from = ws._wsid;
            }

            sendMessage(
                ws, 
                ws._session, 
                ws._protocol, 
                ws._peerProtocol, 
                msg, 
                true);
        }
    }
}

function onClose(ws) {
    return function () {
        if (ws._protocol === 'server') {
            sendMessage(
                ws, 
                ws._session, 
                ws._protocol, 
                ws._peerProtocol, 
                { type: 'disconnected' },
                false);
        }

        var needClean;
        ws._session[ws._protocol].forEach(function (w, index) {
            if (w === ws) {
                ws._session[ws._protocol][index] = undefined;
                needClean = true;
            }
        });

        cleanSession(ws._session);
    }
}

wss.on('connection', function(ws) {
    var session = sessions[ws._id];
    if (session) {
        if (ws._protocol === 'client' && session[ws._protocol].length > 0) {
            try {
                ws._sendFormatted({ type: 'error', code: 409, msg: 'Cannot connect more than one controller to the session' });
                ws.close();
            }
            catch (e) {}
            return;
        }
    }
    else {
        session = { wsid: 0, id: ws._id, client: [], server: [] };
        sessions[ws._id] = session;
    }

    ws._wsid = session.wsid++;
    session[ws._protocol].push(ws);
    ws._session = session;
    ws.on('message', onMessage(ws));
    ws.on('close', onClose(ws));
    ws.on('error', onClose(ws));
    if (ws._protocol === 'client') {
        builtIns['.status'](ws);
    }
}).on('error', console.log);
