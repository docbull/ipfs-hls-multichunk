'use strict'

class IPFSHlsMultiChunk {
  constructor(config) {
    this.multiChunkReq = 5;
    this._abortFlag = [ false ];
    this.ipfs = config.ipfs
    this.hash = config.ipfsHash
    if (config.debug === false) {
      this.debug = function() {}
    } else if (config.debug === true) {
      this.debug = console.log
    } else {
      this.debug = config.debug
    }
    if(config.m3u8provider) {
      this.m3u8provider = config.m3u8provider;
    } else {
      this.m3u8provider = null;
    }
    if(config.tsListProvider) {
      this.tsListProvider = config.tsListProvider;
    } else {
      this.tsListProvider = null;
    }
  }

  destroy() {
  }

  abort() {
    this._abortFlag[0] = true;
  }

  load(context, config, callbacks) {
    this.context = context
    this.config = config
    this.callbacks = callbacks
    this.stats = { trequest: performance.now(), retry: 0 }
    this.retryDelay = config.retryDelay
    this.loadInternal()
  }
  /**
   * Call this by getting the HLSIPFSLoader instance from hls.js hls.coreComponents[0].loaders.manifest.setM3U8Provider()
   * @param {function} provider
   */
  setM3U8Provider(provider) {
    this.m3u8provider = provider;
  }
  /**
   *
   * @param {function} provider
   */
  setTsListProvider(provider) {
    this.tsListProvider = provider;
  }

  loadInternal() {
    const { multiChunkReq, stats, context, callbacks } = this

    stats.tfirst = Math.max(performance.now(), stats.trequest)
    stats.loaded = 0

    //When using absolute path (https://example.com/index.html) vs https://example.com/
    const urlParts = window.location.href.split("/")
    if(urlParts[urlParts.length - 1] !== "") {
      urlParts[urlParts.length - 1] = ""
    }
    const filename = context.url.replace(urlParts.join("/"), "")

    const options = {}
    if (Number.isFinite(context.rangeStart)) {
        options.offset = context.rangeStart;
        if (Number.isFinite(context.rangeEnd)) {
          options.length = context.rangeEnd - context.rangeStart;
        }
    }

    // docbull watson. -> HLS chunks are can be handled even they were preloaded 
    //                    before default HLS loads the chunk one by one.
    //                    However, the chunks need to be arranged for playback sequentially.
    //                    on testing now ...
    if (filename === "master2.ts" || filename === "master3.ts" || filename === "master4.ts") {
      // ignore received chunks when it requests the video chunks
      const data = (context.responseType === 'arraybuffer') ? res : buf2str(res)
      stats.loaded = stats.total = data.length
      stats.tload = Math.max(stats.tfirst, performance.now())
      const response = { url: context.url, data: data }
      callbacks.onSuccess(response, stats, context)
    }

    if (filename === 'master1.ts') {
      for (var i=0; i<multiChunkReq; i++) {
        let chunk = `master${i+1}.ts`;
        this._abortFlag[0] = false;
        getFile(this.ipfs, this.hash, chunk, options, this.debug, this._abortFlag).then(res => {
          const data = (context.responseType === 'arraybuffer') ? res : buf2str(res);
          stats.loaded = stats.total = data.length;
          stats.tload = Math.max(stats,tfirst, performance.now());
          const response = { url: context.url, data: data }
          callbacks.onSuccess(response, stats, context)
        }, console.error);
      }
    }

    if(filename.split(".")[1] === "m3u8" && this.m3u8provider !== null) {
      const res = this.m3u8provider();
      let data;
      if(Buffer.isBuffer(res)) {
        data = buf2str(res)
      } else {
        data = res;
      }
      const response = { url: context.url, data: data }
      callbacks.onSuccess(response, stats, context)
      return;
    }
    if(filename.split(".")[1] === "m3u8" && this.tsListProvider !== null) {
      var tslist = this.tsListProvider();
      var hash = tslist[filename];
      if(hash) {
        this.cat(hash).then(res => {
          let data;
          if(Buffer.isBuffer(res)) {
            data = buf2str(res)
          } else {
            data = res;
          }
          stats.loaded = stats.total = data.length
          stats.tload = Math.max(stats.tfirst, performance.now())
          const response = { url: context.url, data: data }
          callbacks.onSuccess(response, stats, context)
        });
      }
      return;
    }
    this._abortFlag[0] = false;
    getFile(this.ipfs, this.hash, filename, options, this.debug, this._abortFlag).then(res => {
      const data = (context.responseType === 'arraybuffer') ? res : buf2str(res)
      stats.loaded = stats.total = data.length
      stats.tload = Math.max(stats.tfirst, performance.now())
      const response = { url: context.url, data: data }
      callbacks.onSuccess(response, stats, context)
    }, console.error)
  }
}
async function getFile(ipfs, rootHash, filename, options, debug, abortFlag) {
  debug(`Fetching hash for '${rootHash}/${filename}'`)
  const path = `${rootHash}/${filename}`
  try {
    return await cat(path, options, ipfs, debug, abortFlag)
  } catch(ex) {
    throw new Error(`File not found: ${rootHash}/${filename}`)
  }
}

function buf2str(buf) {
  return new TextDecoder().decode(buf)
}

async function cat(cid, options, ipfs, debug, abortFlag) {
  let start = new Date()
  const parts = []
  let length = 0, offset = 0

  for await (const buf of ipfs.cat(cid, options)) {
    parts.push(buf)
    length += buf.length
    if (abortFlag[0]) {
      debug('Cancel reading from ipfs')
      break
    }
  }

  const value = new Uint8Array(length)
  for (const buf of parts) {
    value.set(buf, offset)
    offset += buf.length
  }

  let end = new Date();
  console.log(`📥 ${n} IPFS cat latency: ${end-start}ms`)
  debug(`Received data for file '${cid}' size: ${value.length} in ${parts.length} blocks`)
  return value
}

exports = module.exports = IPFSHlsMultiChunk
