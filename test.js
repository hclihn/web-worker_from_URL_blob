function createWorker(
  worker_setup,
  n_cpy = 1,
  msg_fn = null,
  err_fn = null,
  extra_fns = []
) {
  if (n_cpy <= 0) return [];

  let dataObj = `(${worker_setup})();`; // here is the trick to convert the above fucntion to string
  extra_fns.forEach((fn) => {
    //console.log(`packing ${fn.name}`);
    dataObj += `
${fn}`;
  });

  const blob = new Blob([dataObj.replace(/"use strict";/g, "")]); // firefox adds "use strict"; to any function which might block worker execution so knock it off
  blob.text().then((t) => console.log(t));
  const blobURL = URL.createObjectURL(blob, {
    type: "application/javascript; charset=utf-8"
  });
  let workers = [];
  for (let i = 0; i < n_cpy; i++) {
    let worker = new Worker(blobURL); // spawn new worker
    if (msg_fn) worker.onmessage = msg_fn;
    if (err_fn) worker.onerror = err_fn;
    workers.push(worker);
  }
  URL.revokeObjectURL(blobURL);
  return workers;
}

function testMult(x, y) {
  return x * y;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function worker1_setup() {
  var self = this;
  self.ch = null;
  self.name = null;
  self.onmessage = (e) => {
    const data = e.data;
    switch (data.cmd) {
      case "register":
        self.ch = e.ports[0];
        self.name = data.name;
        self.ch.onmessage = self.onMsg;
        console.log(`register task worker ${self.name}`, e);
        worker_ready(self.ch);
        //postMessage([self.name]); // ready
        break;
      default:
        throw new Error(`unknown command ${data.cmd} sent to ${self.name}}`);
    }
  };
  self.onMsg = (e) => {
    const data = e.data;
    console.log(`${self.name} received task:`, data);
    switch (data.cmd) {
      case "run":
        worker_run(self.ch, data.idx, data.args);
        break;
      default:
        throw new Error(`unknown command ${data.cmd}`);
    }
  };
}

function worker_ready(ch) {
  console.log(`${self.name} ready!`, ch);
  ch.postMessage("ready");
}

async function worker_run(ch, idx, data) {
  await sleep(Math.ceil(Math.random() * 3000));
  let args = JSON.parse(new TextDecoder("utf-8").decode(data));
  const ans = testMult.apply(null, args);
  postMessage([self.name, idx, `test for ${args} is ${ans}`]);
  worker_ready(ch);
}

function worker0_setup() {
  var self = this;
  self.status = [];
  self.gen = run_test_gen();
  self.onmessage = (e) => {
    const data = e.data;
    switch (data.cmd) {
      case "add":
        console.log("main worker add", e);
        this.status.push(new ch_info(data.name, e.ports[0]));
        break;
      case "ready":
        console.log("main worker ready:", data.name);
        for (let i = 0; i < self.status.length; i++) {
          let ci = self.status[i];
          if (data.name === ci.name) {
            ci.busy = false;
            const args = self.gen.next().value;
            if (typeof args === "undefined") {
              console.log("main worker done");
              return;
            }
            console.log(`send task to ${ci.name} with ${args}`);
            const buf = new TextEncoder().encode(JSON.stringify(args));
            ci.ch.postMessage({ cmd: "run", args: buf }, [buf.buffer]);
            ci.busy = true;
            break;
          }
        }
        break;
      default:
        throw new Error(`unknown command ${data.cmd}`);
    }
  };
}

function ch_info(name, ch) {
  if (!(this instanceof ch_info)) {
    // call the constructor again with new
    return new ch_info(name, ch);
  }
  this.name = name;
  this.ch = ch;
  this.busy = false;
  this.ch.onmessage = (e) => {
    console.log(`main worker received from task worker ${name}`, e.data);
    if (e.data === "ready") {
      this.busy = false;
      const v = gen.next().value;
      if (typeof v === "undefined") {
        console.log("main worker done");
        return;
      }
      const [idx, args] = v;
      console.log(`!! send task ${idx} to ${name} with ${args}`);
      //ch.postMessage({cmd: 'run', args: args});
      run_task(ch, idx, args);
      this.busy = true;
    }
  };
  console.log("main worker add:", this.name, this.ch);
}

function run_task(ch, idx, args) {
  const buf = new TextEncoder().encode(JSON.stringify(args));
  ch.postMessage({ cmd: "run", args: buf, idx: idx }, [buf.buffer]);
}

function* run_test_gen() {
  const n = 20;
  for (let i = 0; i < n; i++) {
    console.log(`run test ${i}`);
    yield [i, [5, i + 1]];
  }
  console.log("run test done");
}
var m_worker = createWorker(
  worker0_setup,
  1,
  null,
  (e) => {
    console.log(`main worker error @ line ${e.lineno}: ${e.message}`);
  },
  [ch_info, run_test_gen, sleep, run_task]
)[0];

const n_worker = 5;
let s_workers = createWorker(worker1_setup, n_worker, null, null, [
  worker_ready,
  worker_run,
  sleep,
  testMult
]);
let results = [];
for (let i = 0; i < n_worker; i++) {
  let s = s_workers[i];
  let name = `task_worker_${i}`;
  s.onerror = function (e) {
    console.log(`task worker ${name} error @ line ${e.lineno}: ${e.message}`);
  };
  s.onmessage = function (e) {
    if (e.data.length > 1) {
      results[e.data[1]] = e.data[2];
      console.log(
        `task worker ${name} finished task ${e.data[1]}:`,
        e.data[2],
        results.length,
        results
      );
    }
    //m_worker.postMessage({cmd: 'ready', name: e.data[0]});
  };
  let mch = new MessageChannel();
  //channels.push(mch);
  m_worker.postMessage({ cmd: "add", name: name }, [mch.port1]);
  s.postMessage({ cmd: "register", name: name }, [mch.port2]);
}

function stop() {
  console.log("terminate all workers");
  m_worker.terminate();
  s_workers.forEach((s) => {
    s.terminate();
  });
}
