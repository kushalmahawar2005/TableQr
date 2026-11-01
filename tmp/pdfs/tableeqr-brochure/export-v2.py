from pathlib import Path
from PIL import Image
from reportlab.pdfgen import canvas
from reportlab.lib.utils import ImageReader
from io import BytesIO
import json
root=Path.cwd();p=root/'tmp/pdfs/tableeqr-brochure';out=root/'output/pdf'
c=canvas.Canvas(str(out/'Tableeqr-Beta-Brochure.pdf'),pagesize=(540,960));c.setTitle('Tableeqr | Restaurant & Hotel Management');c.setAuthor('Tableeqr')
links=json.loads((p/'links-v2.json').read_text())
for i in range(8):
 im=Image.open(p/f'v2-page-{i+1}.png').convert('RGB');b=BytesIO();im.save(b,format='JPEG',quality=94,subsampling=0);b.seek(0)
 c.drawImage(ImageReader(b),0,0,540,960)
 for l in links[i]:c.linkURL(l['url'],(l['x'],960-l['y']-l['h'],l['x']+l['w'],960-l['y']),relative=0)
 c.showPage()
c.save()
