(function (id) {

    var BuiltIns = function () {}

    BuiltIns.prototype.ls = function () {
        return navigator.userAgent;
    };

    var builtins = new BuiltIns();
    var address = 'ws://' + window.location.host + '/' + id;
    var socket = new WebSocket(address, 'server');

    socket.onmessage = function (msg) {
        try {
            var data = typeof msg.data === 'string' ? msg.data.trim() : '';
            var k;
            if (data[0] === '.') {
                if (data[data.length - 1] !== ')' && data[data.length - 1] !== ';')
                    data += '()';
                k = eval('builtins' + data);
            }
            else {
                k = eval.call(window, data);
            }

            socket.send(k + '');
        }
        catch (e) {
            socket.send('ERROR:\n' + e);
        }
    };

    socket.onerror = function (e) {
        alert('replmobi error: ' + e);
    };

    socket.onclose = function () {
        alert('replmobi connection closed')
    };
})