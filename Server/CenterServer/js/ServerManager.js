"use strict";
/// <reference path="../typings/index.d.ts" />
/// <reference path="../../Common/common.d.ts" />
/// <reference path="../../Common/routerinterface.d.ts" />
Object.defineProperty(exports, "__esModule", { value: true });
var fs = require("fs");
var QueueClient_1 = require("./QueueClient");
var AgentManager_1 = require("./AgentManager");
var buffer_1 = require("buffer");
var config = JSON.parse(fs.readFileSync("../Config/config.json", "utf8"));
setInterval(function () {
    ServerManager.processGamePair();
}, 5000);
var ServerManager = /** @class */ (function () {
    function ServerManager() {
    }
    ServerManager.onReceiveMessage = function (conn, data) {
        try {
            var dataObj = JSON.parse(data);
            console.log("~~~~csMsg" + data);
            ServerManager.processMessage(conn, dataObj);
        }
        catch (e) {
            console.log("invalid message:" + data);
        }
    };
    ServerManager.processMessage = function (conn, message) {
        switch (message.cmd) {
            case MessageProto.command.CMD_GS_FETCH_USERTOKEN:
                ServerManager.processGSFetchUserToken(conn, message);
                break;
            case MessageProto.command.CMD_GS_QUERYACCOUNT:
                ServerManager.processGSQueryAccount(conn, message);
                break;
            case MessageProto.command.CMD_GS_UPDATEACCOUNT:
                ServerManager.processGSUpdateAccount(conn, message);
                break;
            case MessageProto.command.CMD_GS_CLOSE:
                ServerManager.removeConn(conn);
                break;
        }
    };
    ServerManager.processZoneGamePair = function (zone, zoneQueueList) {
        if (zoneQueueList.length == 0) {
            return;
        }
        if (Object.keys(ServerManager.notFullServerList).length > 0) {
            var keys = Object.keys(ServerManager.notFullServerList);
            for (var i = 0; i < keys.length; i++) {
                if (zoneQueueList.length == 0) {
                    return;
                }
                var canPutNum = config.centerServer.gameconfig.maxplayercnt - ServerManager.notFullServerList[keys[i]].userList.length;
                var tmpServer = ServerManager.notFullServerList[keys[i]];
                // only search valid zone
                if (tmpServer.serverInfo.zone != zone) {
                    continue;
                }
                for (var j = 0; j < canPutNum; j++) {
                    if (zoneQueueList.length == 0) {
                        return;
                    }
                    var tmpReq = zoneQueueList[0];
                    zoneQueueList.splice(0, 1);
                    tmpServer.userList.push({
                        strAccount: tmpReq.accountInfo.strAccount,
                        strToken: tmpReq.accountInfo.strToken,
                        headiconurl: tmpReq.accountInfo.headiconurl,
                        strName: tmpReq.accountInfo.strName,
                        connKey: tmpReq.accountInfo.connKey,
                    });
                    // ???????????????????????????
                    var scMessage = {
                        cmd: MessageProto.command.CMD_GS_ADD_USER,
                        newUser: {
                            account: tmpReq.accountInfo.strAccount,
                            token: tmpReq.accountInfo.strToken,
                            name: tmpReq.accountInfo.strName,
                            headurl: tmpReq.accountInfo.headiconurl,
                        }
                    };
                    ServerManager.sendSCMessage(tmpServer.serverInfo._user, scMessage);
                    // ??????????????????????????????
                    var scClientMsg = {
                        cmd: MessageProto.command.CMD_CLIENT_JOIN_GAME,
                        host: tmpServer.serverInfo.host,
                        port: tmpServer.serverInfo.port,
                        serverkey: tmpServer.serverInfo.serverKey,
                    };
                    var client = QueueClient_1.QueueClient.getClient(tmpReq.accountInfo.connKey);
                    QueueClient_1.QueueClient.sendSCMessage(client, scClientMsg);
                }
                // ????????????????????????FullList
                if (tmpServer.userList.length >= config.centerServer.gameconfig.maxplayercnt) {
                    delete ServerManager.notFullServerList[tmpServer.serverInfo.serverKey];
                    ServerManager.fullServerList[tmpServer.serverInfo.serverKey] = tmpServer;
                }
            }
        }
        // ????????????????????????????????????????????????????????????????????????
        while (zoneQueueList.length >= config.centerServer.gameconfig.minplayercnt) {
            var readyGroup = {
                userList: []
            };
            for (var i = 0; i < config.centerServer.gameconfig.maxplayercnt; i++) {
                if (zoneQueueList.length == 0) {
                    break;
                }
                var tmpReq = zoneQueueList[0];
                zoneQueueList.splice(0, 1);
                readyGroup.userList.push({
                    strAccount: tmpReq.accountInfo.strAccount,
                    strToken: tmpReq.accountInfo.strToken,
                    headiconurl: tmpReq.accountInfo.headiconurl,
                    strName: tmpReq.accountInfo.strName,
                    connKey: tmpReq.accountInfo.connKey,
                });
            }
            if (ServerManager.readyPairList[zone] == null) {
                ServerManager.readyPairList[zone] = [];
            }
            ServerManager.readyPairList[zone].push(readyGroup);
            // ????????????Agent?????????Server
            AgentManager_1.AgentManager.randomCreateServer(zone);
        }
    };
    ServerManager.processGamePair = function () {
        var keys = Object.keys(QueueClient_1.QueueClient.clientQueueList);
        for (var i = 0; i < keys.length; i++) {
            var zone = parseInt(keys[i]);
            ServerManager.processZoneGamePair(zone, QueueClient_1.QueueClient.clientQueueList[zone]);
        }
    };
    ServerManager.processGSUpdateAccount = function (conn, message) {
        if (message.accountData == null) {
            return;
        }
        var queryString = new buffer_1.Buffer(message.accountData.account).toString("base64");
        var saveString = new buffer_1.Buffer(JSON.stringify(message.accountData)).toString("base64");
        var redisconn = QueueClient_1.QueueClient.getRedisConn();
        redisconn.set(queryString, saveString);
    };
    ServerManager.processGSQueryAccount = function (conn, message) {
        if (message.accout == null) {
            return;
        }
        var scMessage = {
            cmd: MessageProto.command.CMD_GS_QUERYACCOUNT,
            result: MessageProto.enResult.enResult_Fail,
            accountData: {
                account: "",
                name: "",
                cup: 0,
                segment: 0,
                star: 0,
            }
        };
        var rediConn = QueueClient_1.QueueClient.getRedisConn();
        var queryString = new buffer_1.Buffer(message.accout).toString("base64");
        rediConn.get(queryString, function (error, data) {
            if (error != null) {
                console.log("server query account error:" + error);
                ServerManager.sendSCMessage(conn, scMessage);
                return;
            }
            if (data == null) {
                ServerManager.sendSCMessage(conn, scMessage);
                return;
            }
            var orgData = new buffer_1.Buffer(data, "base64").toString();
            var accoutData = JSON.parse(orgData);
            scMessage.result = MessageProto.enResult.enResult_OK;
            scMessage.accountData = accoutData;
            ServerManager.sendSCMessage(conn, scMessage);
        });
    };
    ServerManager.processGSFetchUserToken = function (conn, message) {
        var scMessage = {
            cmd: MessageProto.command.CMD_GS_FETCH_USERTOKEN,
            result: MessageProto.enResult.enResult_Fail,
            userList: [],
        };
        if (message.zone == null) {
            return;
        }
        var zoneReadyPairList = ServerManager.readyPairList[message.zone];
        if (zoneReadyPairList == null) {
            ServerManager.readyPairList[message.zone] = [];
            zoneReadyPairList = ServerManager.readyPairList[message.zone];
        }
        if (zoneReadyPairList.length == 0) {
            ServerManager.sendSCMessage(conn, scMessage);
            return;
        }
        scMessage.result = MessageProto.enResult.enResult_OK;
        // ???????????????List,??????Client???ServerKey??????
        var readyGroup = zoneReadyPairList[0];
        zoneReadyPairList.splice(0, 1);
        var serverStatus = {
            userList: [],
            serverInfo: {
                host: message.host,
                port: message.port,
                serverKey: message.serverKey,
                _user: conn,
                zone: message.zone,
            }
        };
        for (var i = 0; i < readyGroup.userList.length; i++) {
            var client = QueueClient_1.QueueClient.getClient(readyGroup.userList[i].connKey);
            if (client == null || client._user == null) {
                continue;
            }
            var connUserInfo = client._user;
            connUserInfo.serverKey = message.serverKey;
            serverStatus.userList.push({
                strAccount: readyGroup.userList[i].strAccount,
                strToken: readyGroup.userList[i].strToken,
                headiconurl: readyGroup.userList[i].headiconurl,
                strName: readyGroup.userList[i].strName,
                connKey: readyGroup.userList[i].connKey,
            });
            scMessage.userList.push({
                account: readyGroup.userList[i].strAccount,
                token: readyGroup.userList[i].strToken,
                name: readyGroup.userList[i].strName,
                headurl: readyGroup.userList[i].headiconurl,
            });
            // ??????????????????????????????
            var scClientMsg = {
                cmd: MessageProto.command.CMD_CLIENT_JOIN_GAME,
                host: message.host,
                port: message.port,
                serverkey: message.serverKey,
            };
            QueueClient_1.QueueClient.sendSCMessage(client, scClientMsg);
        }
        if (serverStatus.userList.length >= config.centerServer.gameconfig.maxplayercnt) {
            ServerManager.fullServerList[message.serverKey] = serverStatus;
        }
        else {
            ServerManager.notFullServerList[message.serverKey] = serverStatus;
        }
        // ??????UserInfo
        var serverConnInfo = {
            serverKey: message.serverKey,
        };
        conn._user = serverConnInfo;
        // ???????????????
        ServerManager.sendSCMessage(conn, scMessage);
    };
    ServerManager.sendSCMessage = function (conn, data) {
        conn.send(JSON.stringify(data), null, function (error) {
            if (error != null) {
                return;
            }
        });
    };
    ServerManager.onClose = function (conn, reason, desc) {
        ServerManager.removeConn(conn);
    };
    ServerManager.OnError = function (conn, error) {
        ServerManager.removeConn(conn);
    };
    ServerManager.removeConn = function (conn) {
        var connServerInfo = conn._user;
        if (connServerInfo != null) {
            if (this.notFullServerList[connServerInfo.serverKey] != null) {
                delete this.notFullServerList[connServerInfo.serverKey];
            }
            if (this.fullServerList[connServerInfo.serverKey] != null) {
                delete this.fullServerList[connServerInfo.serverKey];
            }
        }
    };
    ServerManager.getOwnGame = function (strAccount) {
        // ??????
        var result = ServerManager.findOwnGame(ServerManager.notFullServerList, strAccount);
        if (result != null) {
            return result;
        }
        result = ServerManager.findOwnGame(ServerManager.fullServerList, strAccount);
        return result;
    };
    ServerManager.findOwnGame = function (serverList, strAccount) {
        var keys = Object.keys(serverList);
        for (var i = 0; i < keys.length; i++) {
            for (var j = 0; j < serverList[keys[i]].userList.length; j++) {
                if (serverList[keys[i]].userList[i].strAccount == strAccount) {
                    return serverList[keys[i]];
                }
            }
        }
        return null;
    };
    ServerManager.getKey = function (conn) {
        var key = conn._socket.remoteAddress + "_" + conn._socket.remotePort;
        return key;
    };
    ServerManager.fullServerList = {};
    ServerManager.notFullServerList = {};
    ServerManager.readyPairList = {};
    return ServerManager;
}());
exports.ServerManager = ServerManager;
//# sourceMappingURL=ServerManager.js.map