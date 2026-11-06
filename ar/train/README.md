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

## 训练好以后：给网页用的精简版

SAVE 下载的是训练存档（约 35 MB）：网络权重存成 17 位左右的小数，还带着学习曲线和训练脚本，继续训练时用 OPEN 读回。网页只需要网络本身：

```sh
python3 ar/nn/slim.py <训练存档>.json ar/nn/NN_SAKURA.json
```

去掉只有训练用到的内容，每个数保留 4 位有效数字，约 15 MB，GitHub Pages 压缩传输后约 4.4 MB。格式不变，运行库直接读。官方付费压缩的网络只保留约 2–3 位有效数字，这里的精度高得多。用 WebAR.rocks.object 实测过（数字保留 9 位时和存档逐位一致）：保留 6 位或 4 位时，跟踪结果和存档有差别，但两者差别一样大，说明这是跟踪过程把任何微小差别都放大了，不是精度不够。

训练存档不用放进仓库，在训练电脑上留着就行：每推一份，仓库历史就永久多出 35 MB。

## 背景图

训练时树后面垫的背景，一部分是训练程序自带的随机图，一部分是 `trainingData/images/sakuraBg/` 里的 55 张（各 1024 × 1024 JPG，来源见同目录的 `SOURCES.txt`）：

- 你的书桌照片 5 张，每张截上下两块，共 10 张（照片里的登机牌已经模糊处理）；
- Poly Haven 的 CC0 材质 21 张：木桌面、胶合板、贴皮、大理石、白墙、地砖、布料、皮革、地毯；
- Poly Haven 的 CC0 室内全景 12 张，每张从略低于水平的位置截两块，共 24 张。

训练程序还会随机翻转、旋转、缩放这些图，并调整亮度。想加图的话，按 `bg_<编号>.jpg` 往后编号，边长是 2 的幂，再改脚本里的 `photosCount`。加图要在开始训练前，中途换背景就得从头训练。
