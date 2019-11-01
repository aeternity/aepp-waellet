import { phishingCheckUrl, getPhishingUrls, setPhishingUrl } from './popup/utils/phishing-detect';
import { checkAeppConnected, initializeSDK, removeTxFromStorage, detectBrowser } from './popup/utils/helper';
import WalletContorller from './wallet-controller'
import Notification from './notifications';


import MemoryAccount from '@aeternity/aepp-sdk/es/account/memory'
import { RpcWallet } from '@aeternity/aepp-sdk/es/ae/wallet'
import BrowserRuntimeConnection from '@aeternity/aepp-sdk/es/utils/aepp-wallet-communication/wallet-connection/browser-runtime'




global.browser = require('webextension-polyfill');

// listen for our browerAction to be clicked
chrome.browserAction.onClicked.addListener(function (tab) {
    // for the current tab, inject the "inject.js" file & execute it
	chrome.tabs.executeScript(tab.id, {
        file: 'inject.js'
	}); 
});

setInterval(() => {
    browser.windows.getAll({}).then((wins) => {
        if(wins.length == 0) {
            sessionStorage.removeItem("phishing_urls");
            browser.storage.sync.remove('isLogged')
            browser.storage.sync.remove('activeAccount')
        }
    });
},5000);

chrome.browserAction.setBadgeText({ 'text': 'beta' });
chrome.browserAction.setBadgeBackgroundColor({ color: "#FF004D"});

function getAccount() {
    return new Promise(resolve => {
        chrome.storage.sync.get('userAccount', data => {
            if (data.userAccount && data.userAccount.hasOwnProperty('publicKey')) {
                resolve({ keypair: {
                    publicKey: data.userAccount.publicKey,
                    secretKey: data.userAccount.secretKey
                }})
            }
        })
    });
}

const error = {
    "error": {
        "code": 1,
        "data": {
            "request": {}
        },
        "message": "Transaction verification failed"
    },
    "id": null,
    "jsonrpc": "2.0"
}

browser.runtime.onMessage.addListener( (msg, sender,sendResponse) => {
    switch(msg.method) {
        case 'phishingCheck':
            let data = {...msg, extUrl: browser.extension.getURL ('./') };
            phishingCheckUrl(msg.params.hostname)
            .then(res => {
                if(typeof res.result !== 'undefined' && res.result == 'blocked') {
                    let whitelist = getPhishingUrls().filter(url => url === msg.params.hostname);
                    if(whitelist.length) {
                        data.blocked = false;
                        return postPhishingData(data);
                    }
                    data.blocked = true;
                    return postPhishingData(data);
                }
                data.blocked = false;
                return postPhishingData(data);
            });
        break;
        case 'setPhishingUrl':
            let urls = getPhishingUrls();
            urls.push(msg.params.hostname);
            setPhishingUrl(urls);
        break;
        case 'aeppMessage':
            switch(msg.params.type) {
                case "txSign":
                    checkAeppConnected(msg.params.hostname).then((check) => {
                        if(check) {
                            openAeppPopup(msg,'txSign')
                            .then(res => {
                                sendResponse(res)
                            })
                        }else {
                            error.error.message = "Aepp not registered. Establish connection first"
                            error.id = msg.id
                            sendResponse(error)
                        }
                    });
                break;
                case 'connectConfirm':
                    checkAeppConnected(msg.params.params.hostname).then((check) => {
                        if(!check) {
                            openAeppPopup(msg,'connectConfirm')
                            .then(res => {
                                sendResponse(res)
                            })
                        } else {
                            error.error.message = "Connection already established"
                            error.id = msg.id
                            sendResponse(error)
                        }
                    })
                break;
                case 'getAddress':
                    browser.storage.sync.get('userAccount').then((user)=> {
                        browser.storage.sync.get('isLogged').then((data) => {
                            if (data.isLogged && data.hasOwnProperty('isLogged')) {
                                browser.storage.sync.get('subaccounts').then((subaccounts) => {
                                    browser.storage.sync.get('activeAccount').then((active) => {
                                        let activeIdx = 0
                                        if(active.hasOwnProperty("activeAccount")) {
                                            activeIdx = active.activeAccount
                                        }
                                        let address = subaccounts.subaccounts[activeIdx].publicKey
                                        sendResponse({id:null, jsonrpc:"2.0",address})
                                    })
                                })
                            }else {
                                sendResponse({id:null, jsonrpc:"2.0",address:""})
                            }
                        })
                    })
                break;
                        
                case 'contractCall':
                    checkAeppConnected(msg.params.hostname).then((check) => {
                        if(check) {
                            openAeppPopup(msg,'contractCall')
                            .then(res => {
                                sendResponse(res)
                            })
                        }else {
                            error.error.message = "Aepp not registered. Establish connection first"
                            error.id = msg.id
                            sendResponse(error)
                        }
                    })
                break;

                case 'signMessage':
                    checkAeppConnected(msg.params.hostname).then((check) => {
                        if(check) {
                            openAeppPopup(msg,'signMessage')
                            .then(res => {
                                sendResponse(res)
                            })
                        }else {
                            error.error.message = "Aepp not registered. Establish connection first"
                            error.id = msg.id
                            sendResponse(error)
                        }
                    })
                break;

                case 'verifyMessage':
                    checkAeppConnected(msg.params.hostname).then((check) => {
                        if(check) {
                            openAeppPopup(msg,'verifyMessage')
                            .then(res => {
                                sendResponse(res)
                            })
                        }else {
                            error.error.message = "Aepp not registered. Establish connection first"
                            error.id = msg.id
                            sendResponse(error)
                        }
                    })
                break;
            }
        break
    }

    return true
})


const connectToPopup = (cb,type, id) => {
    browser.runtime.onConnect.addListener((port) => {
        port.onMessage.addListener((msg,sender) => {
            msg.id = sender.name
            if(id == sender.name) cb(msg)
        });
        port.onDisconnect.addListener(async (event) => {
            let list = await removeTxFromStorage(event.name)
            browser.storage.sync.set({pendingTransaction: { list } }).then(() => {})
            browser.storage.sync.remove('showAeppPopup').then(() => {}); 
            error.id = event.name
            if(event.name == id) {
                if(type == 'txSign') {
                    error.error.message = "Transaction rejected by user"
                    cb(error)
                }else if(type == 'connectConfirm') {
                    error.error.message = "Connection canceled"
                    cb(error)
                }else if(type == 'contractCall') {
                    error.error.message = "Transaction rejected by user"
                    cb(error)
                }else {
                    cb()
                }
            }
        });
   })
}

const openAeppPopup = (msg,type) => {
    return new Promise((resolve,reject) => {
        browser.storage.sync.set({showAeppPopup:{ data: msg.params, type } } ).then( () => {
            browser.windows.create({
                url: browser.runtime.getURL('./popup/popup.html'),
                type: "popup",
                height: 680,
                width:420
            }).then((window) => {
                connectToPopup((res) => {
                    resolve(res)
                }, type, msg.params.id)
            })
        })
    })
}

const checkPendingTx = () => {
    return new Promise((resolve,reject) => {
        browser.storage.sync.get('pendingTransaction').then((tx) => {
            if(tx.hasOwnProperty("pendingTransaction")) {
                resolve(false)
            }else {
                resolve(false)
            }
        })
    })
}

const postPhishingData = (data) => {
    browser.tabs.query({active:true, currentWindow:true}).then((tabs) => { 
        const message = { method: 'phishingCheck', data };
        tabs.forEach(({ id }) => browser.tabs.sendMessage(id, message)) 
    });
}

const postToContent = (data, tabId) => {
    const message = { method: 'aeppMessage', data };
    browser.tabs.sendMessage(tabId, message)
}

const controller = new WalletContorller()

browser.runtime.onConnect.addListener( ( port ) => {
    console.log(port)
    let extensionUrl = 'chrome-extension'
    if(detectBrowser() == 'Firefox') {
        extensionUrl = 'moz-extension'
    }
    if((port.name == 'popup' && port.sender.id == browser.runtime.id && port.sender.url == `${extensionUrl}://${browser.runtime.id}/popup/popup.html` && detectBrowser() != 'Firefox') || ( detectBrowser() == 'Firefox' && port.name == 'popup' && port.sender.id == browser.runtime.id ) ) {
        port.onMessage.addListener(({ type, payload, uuid}) => {
            controller[type](payload).then((res) => {
                port.postMessage({ uuid, res })
            })
        })  
    }
})  

const notification = new Notification();


/** 
 * AEX-2
 */
const postMessageToContent = (data) => {
    chrome.tabs.query({}, function (tabs) { // TODO think about direct communication with tab
        const message = { method: 'pageMessage', data };
        tabs.forEach(({ id }) => chrome.tabs.sendMessage(id, message)) // Send message to all tabs
    });
}

const account =  MemoryAccount({
    keypair: {
        secretKey: "e22d7b32439e97881683bbc8c2df5abff99621d72bbf150e31a03d8b688998dcd6a8067dc1ffe4fe3f6203eb8e0734c95752f5e668e29be4e32337f94f73bf38",
        publicKey: "ak_2dY7HSsxH3yGL5j7mNvYYjFGTZwqtLNyoLSSaymn1wLKFSneeQ"
    }
})

const accounts = [
    account
]

const NODE_URL = 'https://sdk-testnet.aepps.com'
const NODE_INTERNAL_URL = 'https://sdk-testnet.aepps.com'
const COMPILER_URL = 'https://compiler.aepps.com'


// Init extension stamp from sdk
RpcWallet({
    url: NODE_URL,
    internalUrl: NODE_INTERNAL_URL,
    compilerUrl: COMPILER_URL,
    name: 'Waellet',
    // By default `ExtesionProvider` use first account as default account. You can change active account using `selectAccount (address)` function
    accounts,
    // Hook for sdk registration
    onConnection (aepp, action) {
        if (confirm(`Client ${aepp.info.name} with id ${aepp.id} want to connect`)) {
            action.accept()
        }
    },
    onDisconnect (masg, client) {
      client.disconnect()
    },
    onSubscription (aepp, action) {
        if (confirm(`Aepp ${aepp.info.name} with id ${aepp.id} want to subscribe for accounts`)) {
            action.accept()
        } else { action.deny() }
    },
    onSign (aepp, action) {
        if (confirm(`Aepp ${aepp.info.name} with id ${aepp.id} want to sign tx ${action.params.tx}`)) {
            action.accept()
        } else { action.deny() }
    }
}).then(wallet => {
    // Subscribe for runtime connection
    chrome.runtime.onConnectExternal.addListener(async (port) => {    
        // create Connection
        const connection = await BrowserRuntimeConnection({ connectionInfo: { id: port.sender.frameId }, port })
        // add new aepp to wallet
        wallet.addRpcClient(connection)
    })
    // Share wallet info with extensionId to the page
    // Send wallet connection info to Aepp throug content script
    setInterval(() => wallet.shareWalletInfo(postMessageToContent), 5000)
}).catch(err => {
    console.error(err)
})