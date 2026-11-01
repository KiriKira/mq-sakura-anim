# AR 训练：让手机认出打印出来的樱花树

用 [WebAR.rocks.train](https://github.com/WebAR-rocks/WebAR.rocks.train) 从 `tree.glb` 训练一个神经网络，之后 [WebAR.rocks.object](https://github.com/WebAR-rocks/WebAR.rocks.object) 用它在手机摄像头画面里每一帧找出这棵树的位置和朝向。训练程序跑在浏览器里，用显卡算，要连续跑几天。

- `trainingScripts/SakuraTree_0.js`：训练脚本，从官方打火机示例 `Object3DLighter_0.js` 改的，网络结构不变。
- `trainingData/models3D/sakura/tree.glb`：训练用的树，必须和打印出来的那棵一模一样（同样的网址和设置）。现在是 `HTTPS://MQ.OPENKIRI.ZIP` 那棵，按打印件缩放到 41 × 41 × 27 mm（水平 × 0.8775，高度 × 0.8177，和 `sakuraqr-mq-openkiri-41x41-facecolor.3mf` 一样）。仓库根目录的 `tree.glb` 是演示动画用的，还是缩放前的 1.5 mm 版本。换打印件时，这里的树也要跟着换。

## 准备（Windows + Edge）

1. 下载 WebAR.rocks.train：用 git 克隆，或者在 GitHub 页面点 Code → Download ZIP 再解压。本脚本对照的是提交 `88529cc`（2026-08-03）。
2. 把本目录下的 `trainingScripts` 和 `trainingData` 两个文件夹复制进 WebAR.rocks.train 的文件夹，提示同名文件夹时选“合并”。
3. 在 WebAR.rocks.train 文件夹里启动本地服务（二选一）：
   - 装了 Python：`python -m http.server 8000`（Microsoft Store 里可以装 Python）
   - 装了 Node.js：`npx http-server . -p 8000`
4. 用 Edge 打开 <http://localhost:8000/trainer.html?code=SakuraTree_0.js>

## 先检查样本

开始真正训练前，先看一眼训练程序画出来的树对不对：

1. 在左边脚本里把 `//settings.debug = true;` 前面的 `//` 删掉，点 RUN。
2. 等十几秒点 PAUSE，再点几次 STEP。右边 LIVE GPU VIEW 里选 `LAYER 0 (input)` → `output composed`，看到的就是网络的输入：一棵树，从正上方到斜侧面各种角度，背景、模糊、明暗随机。有些样本树偏到一边或者底座被裁掉一块，这是故意的，网络要学会把检测窗口挪回去。
3. 没问题就刷新页面（脚本会恢复成文件里的样子，`debug` 是关的），点 RUN 开始训练。

## 训练

- 训练要连续跑几天，显卡一直满载。官方打火机模型在 RTX 2060 上训练了 11 天。
- 训练期间：
  - Windows 电源设置里关掉睡眠。
  - Edge 的标签页休眠（设置 → 系统和性能）里把 `localhost` 加进“永不休眠”的站点。
  - 训练页单独开一个窗口，不要最小化：浏览器会给后台页面限速。开始后看 STATS 里的 Learning Speed（img/s），切到别的窗口后明显变慢的话，就让它一直在前台。
- 每隔一天左右点 PAUSE → SAVE 存一份网络，再点 RESUME 继续。万一浏览器崩了，可以用 OPEN 读回最近一份接着训练。
- TEST 页是误差曲线，每 1 万个批次测一次。曲线走平以后 SAVE，下载的 `.json` 就是训练好的网络。

## 自己拍的背景照片（建议）

训练时树下面垫的是随机背景。换成你实际会用 AR 的地方（书桌、柜子、桌面）的照片，认得会更准：

1. 拍 30–60 张这些地方的照片，**画面里不要有这棵树**。远景、近景、不同光线都要有。
2. 放进本仓库的 `ar/train/photos/` 推上来。之后把它们转换成训练程序要的格式（`trainingData/images/sakuraBg/bg_<编号>.png`，边长是 2 的幂），再把脚本里的 `photosCount` 改成张数。
