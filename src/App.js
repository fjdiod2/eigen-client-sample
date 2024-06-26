import logo from './logo.svg';
import './App.css';
import { useState, useEffect } from "react";

const eigenKey = "";//API key
const agentId = "";//
const baseURL = "https://eigenchat.com/api";
let sampleRate = 24000;//sample rate of returned audio


let nextTime = 0;
let context = new window.AudioContext();
const ltok = "";// to test existing session past access token here
const url = "streamaaa.chadview.com";// to test existing session past url token here
const portTest = 9001;// to test existing session past url token here
if (navigator.audioSession !== undefined) {
    navigator.audioSession.type = 'play-and-record';
}
let source = [];
let textBuffer = [];
const gainNode = context.createGain();
gainNode.gain.value = 1;
gainNode.connect(context.destination);


function base2array(text) {
    // decode base64 encoded audio data
    const blob = window.atob(text);
    const fLen = blob.length / Float32Array.BYTES_PER_ELEMENT;
    const dView	= new DataView( new ArrayBuffer(Float32Array.BYTES_PER_ELEMENT));
    let fAry = new Float32Array(fLen);
    let p = 0;
    for(var j=0; j < fLen; j++){
        p = j * 4;
        dView.setUint8(0,blob.charCodeAt(p));
        dView.setUint8(1,blob.charCodeAt(p+1));
        dView.setUint8(2,blob.charCodeAt(p+2));
        dView.setUint8(3,blob.charCodeAt(p+3));
        fAry[j] = dView.getFloat32(0,true);
    }
    return fAry;
}


function getChunk(chunk, setFinished) {
    // create BufferSource with audio response
    console.log("PLAYING CHUNK", Date.now());
    setFinished(false);
    let buffer = null;
    const size = chunk.length;
    buffer = context.createBuffer(2, size, sampleRate);
    buffer.getChannelData(0).set(chunk, 0);
    const tmp = context.createBufferSource();
    source.push(tmp);
    tmp.buffer = buffer;
    tmp.addEventListener("ended", () => {
        source.shift();
        if (source.length === 0) {
            setFinished(true);
        }
    });

    tmp.connect(gainNode);
    // source.start(offset);
    return tmp;
}


function websocketListener(event, setInterrupt, setFinished, setGenerating) {
    //process messages from the socket
    const {reply_text, audio, status, message, finished, generating, sample_rate,
           interrupt,} = JSON.parse(event.data);

    if(reply_text !== undefined && reply_text !== null) {
        console.log("TRANSCRIPT", reply_text);
    }

    if(sample_rate !== undefined && sample_rate !== null) {
        console.log("SAMPLE RATE", sample_rate);
        sampleRate = sample_rate;
    }

    if(generating !== undefined && generating !== null) {
        setGenerating(true);
        setInterrupt(false);
        console.log("GENERATING");
    }

    if(finished !== undefined && finished !== null) {
        setGenerating(false);
        console.log("GENERATION FINISHED");
    }

    if(status !== undefined && status !== null && status !== "ok") {
        console.log("ERROR", status, message);
    }

    if(interrupt !== undefined && interrupt !== null) {
        console.log("INTERRUPTED");
        setInterrupt(true);
    }
    if(audio !== undefined && audio !== null) {
        const tmp = base2array(audio);
        const nw = context.currentTime;
        const chunk = getChunk(tmp, setFinished);

        if (nextTime === 0) {
            nextTime = context.currentTime + 0.05;
        }
        if (context.currentTime > nextTime) {
            nextTime = context.currentTime + 0.05;
        }
        chunk.start(nextTime);
        setTimeout(() => {
            textBuffer.push(reply_text);
            // setSound(audio);
        }, (nextTime - context.currentTime)*1000);
        nextTime += chunk.buffer.duration;

    }

}

const waitForOpenConnection = (socket) => {
    return new Promise((resolve, reject) => {
        const maxNumberOfAttempts = 30;
        const intervalTime = 500; //ms

        let currentAttempt = 0;
        const interval = setInterval(() => {
            if (currentAttempt > maxNumberOfAttempts - 1) {
                clearInterval(interval);
                reject(new Error('Maximum number of attempts exceeded'));
            } else if (socket.readyState === socket.OPEN) {
                clearInterval(interval);
                resolve();
            }
            currentAttempt++;
        }, intervalTime);
    })
}


function arrayBufferToBase64(buffer) {
  let binary = '';
  const bytes = new Uint8Array(buffer);
  const len = bytes.byteLength;
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

function downsampleBuffer(buffer, sampleRate, outSampleRate) {
    // downsample audio
    if (outSampleRate === sampleRate) {
      return buffer;
    }
    if (outSampleRate > sampleRate) {
      throw 'downsampling rate show be smaller than original sample rate';
    }
    var sampleRateRatio = sampleRate / outSampleRate;
    var newLength = Math.round(buffer.length / sampleRateRatio);
    var result = new Int16Array(newLength);
    var offsetResult = 0;
    var offsetBuffer = 0;
    while (offsetResult < result.length) {
      var nextOffsetBuffer = Math.round((offsetResult + 1) * sampleRateRatio);
      var accum = 0,
        count = 0;
      for (var i = offsetBuffer; i < nextOffsetBuffer && i < buffer.length; i++) {
        accum += buffer[i];
        count++;
      }

      result[offsetResult] = Math.min(1, accum / count) * 0x7fff;
      offsetResult++;
      offsetBuffer = nextOffsetBuffer;
    }
    return result.buffer;
}

async function initSocket(url, port, setWebsocket, setInterrupt, agentID, setFinished, setGenerating) {
      const tokenParams = new URLSearchParams({
                                                      expire_time: 120,
                                                      iid: "aaa",
                                                  });
      const token = await (await fetch(`${baseURL}/token?` + tokenParams, {
                                        headers: {"authorization": `Bearer ${eigenKey}`},
                                        })).json();
      console.log(`wss://${url}:${port}`, token.token)
      const websocket = new WebSocket(`wss://${url}:${portTest}`);
      websocket.addEventListener("message", (event) => {
          websocketListener(event, setInterrupt, setFinished, setGenerating);
      });
      await waitForOpenConnection(websocket);
      websocket.send(JSON.stringify({type: "init", token: token.token, agent_id: agentID}));
      setWebsocket(websocket);
}


async function waitForConnection(setWebsocket, agentID, setInterrupt, spawnResults, token, setFinished, setGenerating) {
    while (true) {
        const spawnStatus = await (await fetch(`${baseURL}/status/${spawnResults.iid}`, {
            headers: {"authorization": `Bearer ${eigenKey}`}
        })).json();
        console.log("SPAWN STATUS", spawnStatus)
        if (spawnStatus.status === "ok") {
            const websocket = new WebSocket(`wss://${spawnStatus.domain}:${spawnStatus.port}`);
            websocket.addEventListener("message", (event) => {
                websocketListener(event, setInterrupt, setFinished, setGenerating);
            });
            await waitForOpenConnection(websocket);
            console.log("send", agentID, JSON.stringify({type: "init", agent_id: agentID}), `wss://${spawnStatus.domain}:${spawnStatus.port}`)
            websocket.send(JSON.stringify({type: "init", token: token.token, agent_id: agentID}));
            setWebsocket(websocket);
            //init message

            break
        }
        await new Promise(r => setTimeout(r, 5000));
    }
}


async function createSession(setWebsocket, setToken, setInterrupt, setIID, agentID, setFinished, setGenerating) {

  //request to start a new session
  const spawnResults = await (await fetch(`${baseURL}/spawn`, {
                                    headers: {"authorization": `Bearer ${eigenKey}`},
                                    method: "POST"})).json();
  // const spawnResults = await spawnResponse.json();
  if (spawnResults.status !== "ok") {
    console.log("Something went wrong");
    return
  }
  setIID(spawnResults.iid);
  // get access token for new session
  const tokenParams = new URLSearchParams({
                                                  expire_time: 120,
                                                  iid: spawnResults.iid,
                                              });
  const token = await (await fetch(`${baseURL}/token?` + tokenParams, {
                                    headers: {"authorization": `Bearer ${eigenKey}`},
                                    })).json();
  // const token = await tokenResponse.json();
  setToken(token.token);
  //wait for creation of session
  await waitForConnection(setWebsocket, agentID, setInterrupt, spawnResults, token, setFinished, setGenerating);

}


async function killSession(iid) {
    // stop session
    console.log("killing", iid)
    if (iid !== null) {
        await fetch(`${baseURL}/kill/${iid}`, {
            headers: {"authorization": `Bearer ${eigenKey}`},
            method: "GET"
        })
    }
}


function VoiceChat({ started, agentID }) {
  const [token, setToken] = useState(null);
  const [iid, setIID] = useState(null);
  const [interrupt, setInterrupt] = useState(false);
  const [websocket, setWebsocket] = useState(null);
  const [finished, setFinished] = useState(false);
  const [generating, setGenerating] = useState(false);
  useEffect(() => {
      if (started) {
          createSession(setWebsocket, setToken, setInterrupt, setIID, agentID, setFinished, setGenerating);
          // initSocket(url, portTest, setWebsocket, setInterrupt, agentID, setFinished, setGenerating);
      }
  }, []);

  useEffect(() => {
      console.log("audio_play_finished?", finished, generating)
      if (finished && !generating) {
          console.log("audio_play_finished")
          websocket.send(JSON.stringify({type: "audio_play_finished"}));
      }
  }, [finished, generating])

  useEffect(() => {
    if (websocket !== null) {
        //when connection is opened and inited
        navigator.mediaDevices
            .getUserMedia(
                // constraints - only audio needed for this app
                {
                    audio: true,
                }
            ).then((stream) => {
                const context = new AudioContext();
                const mediaStream = context.createMediaStreamSource(stream);
                const recorder = context.createScriptProcessor(0, 1, 1);
                recorder.onaudioprocess = async (event) => {
                    //get audio from mic
                    const inputData = (event.inputBuffer.getChannelData(0));
                    //service accept 16000 sample rate
                    const int16Array = downsampleBuffer(inputData, context.sampleRate, 16000);
                    websocket.send(JSON.stringify({type: "data", data: arrayBufferToBase64(int16Array)}));
                };
                mediaStream.connect(recorder);
                recorder.connect(context.destination);
        })
    }
  }, [websocket]);

    useEffect(() => {
        if(source !== null) {
            if (interrupt) {
                console.log("stopping sound", source.length);
                for (let i=0; i<source.length;i++) {
                    source[i].stop();
                }
                source = [];
                nextTime = 0;
            }
        }
    }, [interrupt])

    useEffect(() => {
        if(websocket !== null) {
            websocket.close();
            initSocket(url, portTest, setWebsocket, setInterrupt, agentID);
        }
    }, [agentID])

  return (
      <div>
          <button onClick={() => {killSession(iid)}}>Stop Session</button>
      </div>
  )
}

function App() {
  const [started, setStarted] = useState(false);
  return (
    <div>
        {!started ?
            <button onClick={() => {
            setStarted(true)}}>Start
            </button>
            :
            <div>
                <VoiceChat started={started} agentID={agentId}/>
            </div>
        }
    </div>
  );
}

export default App;