# PDF 导出字体

`NotoSansSC-Regular.ttf.gz` 来自 [Noto Sans SC 2.004 的 TrueType 可变字体](https://github.com/notofonts/noto-cjk/blob/Sans2.004/Sans/Variable/TTF/Subset/NotoSansSC-VF.ttf)，使用 FontTools 4.65.0 固定为 400 字重并以 gzip 压缩，保留全部原始字符及版权元数据。授权见同目录 `LICENSE`（SIL Open Font License 1.1）。TrueType 轮廓用于避免 CFF 字体子集在 PDF 阅读器中的兼容问题；加载时一次性解压，避免 WOFF 字形表被重复解压而阻塞界面。

仅在用户导出 PDF 时从本站加载；PDF 按实际用字嵌入子集，以支持中文且避免将整套字体写入每份文件。正文不会发送到外部转换服务。

重新生成：下载上述原始文件后，运行以下 Python（需要 `fonttools==4.65.0`）：

```python
from fontTools.ttLib import TTFont
from fontTools.varLib.instancer import instantiateVariableFont
from io import BytesIO
from pathlib import Path
import gzip

font = instantiateVariableFont(TTFont("NotoSansSC-VF.ttf"), {"wght": 400}, inplace=True)
font["glyf"].padding = 4  # 字形数据对齐，确保 fontkit 生成短 loca 子集时不截断奇数偏移
buffer = BytesIO()
font.save(buffer)
Path("NotoSansSC-Regular.ttf.gz").write_bytes(gzip.compress(buffer.getvalue(), mtime=0))
```
