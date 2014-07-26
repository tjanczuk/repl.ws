(function (id) {

    var address = 'ws://' + window.location.host + '/' + id;
    var socket = new WebSocket(address, 'server');

    function send(socket, msg) {
        socket.send(JSON.stringify(msg));
    }

    var BuiltIns = function () {}

    BuiltIns.prototype.ls = function (cb) {
        return navigator.userAgent || 'N/A';
    };

    BuiltIns.prototype.ld = function (url) {
        var head = document.getElementsByTagName('head')[0];
        var el;

        if (url && url.match(/\.css$/)) {
            el = document.createElement('link');
            el.rel = 'stylesheet';
            el.href = url;
        }
        else {
            el = document.createElement('script');
            el.type = 'text/javascript';
            el.src = url;
        }

        el.onreadystatechange = function () {
            if (this.readyState === 'complete' || this.readyState === 'loaded')
                onLoaded(); 
        };
        el.onload = onLoaded;
        head.appendChild(el);

        setTimeout(function () {
            if (!el._loaded) {
                send(socket, {
                    type: 'error',
                    code: 404,
                    url: url,
                    msg: 'Resource at ' + url + ' did not load within 3s. Check the URL.'
                });
            }
        }, 3000);

        return undefined;

        function onLoaded() {
            if (!el._loaded) {
                el._loaded = true;
                send(socket, {
                    type: 'msg',
                    url: url,
                    msg: 'Loaded ' + url
                });
            }
        }
    };

    BuiltIns.prototype.ldjq = function (version) {
        this.ld('//ajax.googleapis.com/ajax/libs/jquery/V/jquery.min.js'
            .replace('V', version || '2.1.1'));
    };

    BuiltIns.prototype.lddojo = function (version) {
        this.ld('//ajax.googleapis.com/ajax/libs/dojo/V/dojo/dojo.js'
            .replace('V', version || '1.10.0'));
    };

    BuiltIns.prototype.ldext = function (version) {
        this.ld('//ajax.googleapis.com/ajax/libs/ext-core/V/ext-core.js'
            .replace('V', version || '3.1.0'));
    };

    BuiltIns.prototype.ldang = function (version) {
        this.ld('//ajax.googleapis.com/ajax/libs/angularjs/V/angular.min.js'
            .replace('V', version || '1.2.18'));
    };

    BuiltIns.prototype.ldmoo = function (version) {
        this.ld('//ajax.googleapis.com/ajax/libs/mootools/V/mootools-yui-compressed.js'
            .replace('V', version || '1.5.0'));
    };

    BuiltIns.prototype.ldpro = function (version) {
        this.ld('//ajax.googleapis.com/ajax/libs/prototype/V/prototype.js'
            .replace('V', version || '1.7.2.0'));
    };

    BuiltIns.prototype.ldacu = function (version) {
        this.ld('//ajax.googleapis.com/ajax/libs/scriptaculous/V/scriptaculous.js'
            .replace('V', version || '1.9.0'));
    };

    BuiltIns.prototype.ldjqm = function (version) {
        this.ld('//ajax.googleapis.com/ajax/libs/jquerymobile/V/jquery.mobile.min.css'
            .replace('V', version || '1.4.2'));
        this.ld('//ajax.googleapis.com/ajax/libs/jquerymobile/V/jquery.mobile.min.js'
            .replace('V', version || '1.4.2'));                
    };

    BuiltIns.prototype.ldjqui = function (version) {
        this.ld('//ajax.googleapis.com/ajax/libs/jqueryui/V/themes/smoothness/jquery-ui.css'
            .replace('V', version || '1.10.4'));
        this.ld('//ajax.googleapis.com/ajax/libs/jqueryui/V/jquery-ui.min.js'
            .replace('V', version || '1.10.4'));                
    };

    var builtins = new BuiltIns();

    socket.onmessage = function (msg) {
        try {
            var data = typeof msg.data === 'string' ? msg.data.trim() : '{"msg":""}';
            data = JSON.parse(data).msg.trim();
            var k;
            if (data[0] === '.') {
                if (data[data.length - 1] !== ')' && data[data.length - 1] !== ';')
                    data += '()';
                k = eval('builtins' + data);
            }
            else {
                k = eval.call(window, data);
            }

            if (data[0] !== '.' || k !== undefined)
                send(socket, { 
                    type: 'msg',
                    msg: k + ''
                });
        }
        catch (e) {
            send(socket, {
                type: 'error',
                code: 500,
                msg: e.message || e.toString()
            });
        }
    };

    socket.onerror = function (e) {
        alert('repl.ws error: ' + e.message || e.toString());
        socket = null;
    };

    socket.onclose = function () {
        alert('repl.ws connection closed');
        socket = null;
    };

    window.onerror = function (errorMsg, url, lineNumber) {
        try {
            socket && send(socket, {
                type: 'error',
                code: 500,
                url: url,
                line: lineNumber,
                msg: errorMsg + ' at ' + url + ' line ' + lineNumber
            });
        }
        catch (e) {}
        return false;
    };
})