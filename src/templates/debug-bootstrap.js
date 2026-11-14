// @ts-nocheck
// 注入到自定义基座的 app-service.js 末尾：从本机 HTTP 服务拉取最新 wgt 并安装。
(function () {
  if (typeof plus === 'undefined') {
    return
  }
  var PORT = __UNI_PACK_PORT__
  var KEY = '__uni_pack_wgt'
  var base = 'http://127.0.0.1:' + PORT

  function log(message) {
    console.log('[uni-pack] ' + message)
  }

  function lastSha() {
    try {
      return plus.storage.getItem(KEY) || ''
    } catch (error) {
      return ''
    }
  }

  var request = new XMLHttpRequest()
  request.open('GET', base + '/version.json?_=' + Date.now(), true)
  request.timeout = 3000
  request.onload = function () {
    if (request.status !== 200) {
      log('版本服务不可用（' + request.status + '）')
      return
    }
    var info
    try {
      info = JSON.parse(request.responseText)
    } catch (error) {
      log('版本信息解析失败')
      return
    }
    if (!info || !info.sha256 || info.sha256 === lastSha()) {
      return
    }
    log('发现新资源 ' + info.version + '，开始下载')
    var task = plus.downloader.createDownload(base + '/app.wgt', { filename: '_doc/uni-pack.wgt' })
    task.addEventListener('statechanged', function (download) {
      if (download.state !== 4) {
        return
      }
      if (download.status !== 200) {
        log('下载失败（' + download.status + '）')
        return
      }
      plus.runtime.install(
        download.filename,
        { force: true },
        function () {
          try {
            plus.storage.setItem(KEY, info.sha256)
          } catch (error) {
            // 忽略存储失败，下次仍会更新
          }
          log('资源已安装，正在重启')
          setTimeout(function () {
            plus.runtime.restart()
          }, 600)
        },
        function (error) {
          log('安装失败：' + JSON.stringify(error))
        },
      )
    })
    task.start()
  }
  request.onerror = function () {
    log('无法连接本机资源服务')
  }
  request.send()
})()
