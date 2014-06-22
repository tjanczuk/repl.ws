(function (id) {
    var address = 'ws://' + window.location.host + '/' + id;
    var socket = new WebSocket(address, 'server');

    socket.onmessage = function (msg) {
        try {
            var k = eval.call(window, msg.data);
            socket.send(k + '');
        }
        catch (e) {
            socket.send('Error:\n' + e);
        }
    };

    socket.onerror = function (e) {
        alert('replmobi error: ' + e);
    };

    socket.onclose = function () {
        alert('replmobi connection closed')
    };
})