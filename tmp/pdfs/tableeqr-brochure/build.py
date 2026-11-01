from reportlab.pdfgen import canvas
from reportlab.lib.colors import HexColor, Color
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import Paragraph
from reportlab.lib.styles import ParagraphStyle
from reportlab.graphics.barcode import qr
from reportlab.graphics.shapes import Drawing
from reportlab.graphics import renderPDF
from pathlib import Path
ROOT=Path.cwd(); OUT=ROOT/'output/pdf/Tableeqr-Beta-Brochure.pdf'; TMP=ROOT/'tmp/pdfs/tableeqr-brochure'
for n,f in [('R','Arial.ttf'),('B','Arial Bold.ttf')]: pdfmetrics.registerFont(TTFont(n,'/System/Library/Fonts/Supplemental/'+f))
W,H=540,960
NAVY='#111E31'; TEAL='#35D5BD'; INK='#17263A'; WHITE='#FAF9F5'; MUTED='#617182'; LINE='#DFE5E5'; PALE='#E7F5EF'; GOLD='#D7B37A'
c=canvas.Canvas(str(OUT),pagesize=(W,H));c.setTitle('Tableeqr | Every Table. Every Room. Connected.');c.setAuthor('Tableeqr')
def box(x,y,w,h,col,r=0):
 c.setFillColor(HexColor(col));c.setStrokeColor(HexColor(col));c.roundRect(x,H-y-h,w,h,r,fill=1,stroke=0)
def text(x,y,s,size=14,font='R',col=INK):
 c.setFillColor(HexColor(col));c.setFont(font,size);c.drawString(x,H-y-size*.82,s)
def para(x,y,s,w=440,size=15,col=MUTED,leading=None,font='R'):
 st=ParagraphStyle('p',fontName=font,fontSize=size,leading=leading or size*1.45,textColor=HexColor(col))
 p=Paragraph(s,st); _,h=p.wrap(w,900);p.drawOn(c,x,H-y-h);return h

def line(x1,y1,x2,y2,col=LINE,width=1):
 c.setStrokeColor(HexColor(col));c.setLineWidth(width);c.line(x1,H-y1,x2,H-y2)
def circle(x,y,r,col):
 c.setFillColor(HexColor(col));c.circle(x,H-y,r,stroke=0,fill=1)
def brand(dark=False):
 co=WHITE if dark else INK
 # geometric QR-style mark; decorative brand symbol, not a scan target
 for xx,yy in [(0,0),(14,0),(0,14)]:
  box(38+xx,35+yy,10,10,TEAL,2);box(41+xx,38+yy,4,4,NAVY if dark else WHITE,1)
 box(52,49,4,4,TEAL,1);box(58,55,4,4,TEAL,1)
 text(76,34,'Tableeqr',25,'B',co)
def base(num,section,dark=False):
 box(0,0,W,H,NAVY if dark else WHITE);brand(dark)
 text(38,916,'TABLEEQR  /  '+section.upper(),9,'B','#8BA1B5' if dark else MUTED)
 text(473,914,f'{num:02d}',12,'B',TEAL if dark else INK)
 line(38,898,502,898,'#2D4056' if dark else LINE)
def kicker(s,y=109,dark=False):text(38,y,s,10,'B',TEAL if dark else '#16816F')
def heading(lines,y=144,size=42,dark=False):
 for i,s in enumerate(lines):text(38,y+i*(size*1.1),s,size,'B',WHITE if dark else INK)
def icon(name,x,y,s=28,col=TEAL):
 c.saveState();c.translate(x,H-y-s);c.scale(s/32,s/32);c.setStrokeColor(HexColor(col));c.setLineWidth(1.7)
 def ln(a,b,d,e):c.line(a,b,d,e)
 if name=='phone':
  c.roundRect(7,1,18,30,3,stroke=1,fill=0);ln(13,5,19,5);ln(12,27,20,27)
 elif name=='room':
  c.roundRect(7,1,19,29,2,stroke=1,fill=0);c.circle(21,14,1,stroke=1,fill=0);ln(11,25,21,25)
 elif name=='kitchen':
  c.arc(3,11,29,29,0,180);ln(3,20,29,20);ln(8,13,8,3);ln(8,3,24,3);ln(24,3,24,13);ln(11,26,11,30);ln(21,26,21,30)
 elif name=='calendar':
  c.roundRect(3,3,26,25,3,stroke=1,fill=0);ln(3,21,29,21);ln(10,25,10,31);ln(22,25,22,31);ln(9,14,14,14);ln(18,14,23,14);ln(9,8,14,8)
 elif name=='delivery':
  c.rect(1,10,19,15,stroke=1,fill=0);ln(20,20,26,20);ln(26,20,31,14);ln(31,14,31,8);ln(20,8,31,8);c.circle(7,7,4,stroke=1,fill=0);c.circle(25,7,4,stroke=1,fill=0)
 elif name=='chart':
  ln(3,29,3,3);ln(3,3,30,3);ln(9,5,9,13);ln(17,5,17,21);ln(25,5,25,28)
 elif name=='table':
  c.roundRect(4,9,24,14,4,stroke=1,fill=0);ln(8,9,8,3);ln(24,9,24,3);ln(8,23,8,29);ln(24,23,24,29)
 else:
  c.circle(16,16,12,stroke=1,fill=0);ln(10,16,14,12);ln(14,12,23,21)
 c.restoreState()
def feature(y,title,desc,name='check',x=38,w=440):
 icon(name,x,y+2,27,'#16816F');text(x+43,y,title,18,'B');para(x+43,y+29,desc,w-43,13.5)
def phone_image(path,x,y,w=218):
 h=w*880/420
 box(x-7,y-7,w+14,h+14,'#0A1422',27)
 c.saveState()
 clip=c.beginPath();clip.roundRect(x,H-y-h,w,h,20);c.clipPath(clip,stroke=0,fill=0)
 c.drawImage(str(path),x,H-y-h,w,h,mask='auto')
 c.restoreState()
 box(x+w*.36,y-2,w*.28,5,'#0A1422',2)
def qr_draw(url,x,y,size=130):
 q=qr.QrCodeWidget(url);bounds=q.getBounds();d=Drawing(size,size,transform=[size/(bounds[2]-bounds[0]),0,0,size/(bounds[3]-bounds[1]),0,0]);d.add(q);renderPDF.draw(d,c,x,H-y-size)
def pill(x,y,s,dark=False):
 width=pdfmetrics.stringWidth(s,'B',10)+22;box(x,y,width,25,'#22394B' if dark else PALE,12);text(x+11,y+8,s,10,'B',TEAL if dark else '#176A5B');return width

# 1: Cover
base(1,'Restaurant & Hotel Platform',True);kicker('RESTAURANTS  /  CAFES  /  HOTELS',112,True)
heading(['Every Table.','Every Room.'],155,49,True);text(38,269,'Connected.',49,'B',TEAL)
para(38,343,'From the first order to the final bill.<br/>Bring guests, staff and service together.',440,19,'#BECBD7',28)
# Editorial illustration of a table and room connected to the platform
circle(270,626,151,'#182D42');circle(270,626,112,'#1B3547')
box(163,541,215,151,'#264759',36)
for x,y in [(183,515),(305,515),(183,705),(305,705)]:box(x,y,53,13,'#486575',6)
circle(211,612,25,'#F5F0E7');circle(330,612,25,'#F5F0E7');circle(211,612,17,'#D8E9E1');circle(330,612,17,'#D8E9E1')
box(244,575,52,72,WHITE,8);icon('phone',255,588,30,'#16816F')
box(48,482,133,56,WHITE,12);icon('check',60,495,25,'#16816F');text(94,494,'Order received',11,'B');text(94,513,'Kitchen notified',9,'R',MUTED)
box(340,697,162,65,WHITE,12);icon('room',352,711,30,'#16816F');text(391,710,'Room service',12,'B');text(391,730,'One connected flow',10,'R',MUTED)
text(38,812,'Dining. Delivery. Reservations. Room service.',14,'B',WHITE)
pill(38,849,'BETA  /  EARLY ACCESS',True);text(385,857,'tableqr.in',12,'R','#BECBD7');c.showPage()

# 2 overview
base(2,'One Platform');kicker('THE TABLEEQR EXPERIENCE');heading(['Your operations,','together.'])
para(38,257,'Give every part of your business a place in the same service flow.',440,17)
# connected diagram
line(270,400,270,710,'#B8D8CE',3);line(138,450,402,450,'#B8D8CE',3);line(138,656,402,656,'#B8D8CE',3)
circle(270,552,70,NAVY);text(216,535,'Tableeqr',25,'B',WHITE);text(229,569,'ONE PLATFORM',9,'B',TEAL)
for x,y,name,title in [(82,358,'table','Dine-in'),(347,358,'calendar','Reservations'),(82,564,'kitchen','Kitchen'),(347,564,'delivery','Delivery'),(82,744,'room','Hotel rooms'),(347,744,'chart','Owner control')]:
 box(x,y,110,87,PALE,18);icon(name,x+38,y+13,33,'#16816F');text(x+10,y+61,title,12,'B')
para(38,851,'Keep guests informed. Keep your team in sync.',440,14,INK,font='B');c.showPage()

# 3 guests
base(3,'Guest Experience');kicker('AT THE TABLE');heading(['Scan. Order.','Enjoy.'])
para(38,252,'A familiar phone. A simpler dining experience.',440,17)
menu=TMP/'menu-final.png'
phone_image(menu,281,344,205)
for yy,no,title,desc in [(355,'01','Scan the table QR','Open the guest experience<br/>without installing an app.'),(480,'02','Choose & order','Browse in English or Hindi.<br/>Add dishes and order together.'),(605,'03','Ask for service','Send a request straight<br/>to your restaurant team.'),(730,'04','Settle the bill','Split by your items, equally<br/>or with custom amounts.')]:
 text(38,yy,no,12,'B','#16816F');text(38,yy+27,title,18,'B');para(38,yy+58,desc,220,13.5)
text(287,789,'Actual Tableeqr guest screen',9,'R',MUTED)
box(38,837,464,40,NAVY,9);text(57,851,'Shared table. Individual choices. Clear bills.',13,'B',WHITE);c.showPage()

#4 restaurant
base(4,'Restaurant Operations',True);kicker('FOR YOUR FLOOR & KITCHEN',109,True);heading(['Keep every','shift moving.'],151,44,True)
para(38,264,'Give your floor, waiters and kitchen a shared view of service.',440,17,'#BECBD7')
# simple stylised floor diagram
box(38,357,464,241,'#1C3045',18);text(58,379,'FLOOR  /  SERVICE FLOW',10,'B',TEAL)
for x,y,label,status,color in [(63,427,'T01','Available','#35D5BD'),(220,427,'T02','Ordering','#D7B37A'),(377,427,'T03','Serving','#8FB6EE')]:
 box(x,y,99,78,'#2B4257',15);text(x+27,y+18,label,21,'B',WHITE);text(x+16,y+51,status,10,'R',color)
line(90,539,446,539,'#4D6B7C',2)
for x,label in [(70,'Guest order'),(224,'Kitchen ticket'),(382,'Ready to serve')]:circle(x+19,539,5,TEAL);text(x,560,label,10,'B',WHITE)
text(58,615,'Service flow illustration',9,'R','#8BA1B5')
for y,title,desc in [(658,'Live floor & waiter assignment','See tables, route tasks and manage service requests.'),(731,'Kitchen display & order status','Keep incoming orders visible to the kitchen team.'),(804,'POS billing & menu controls','Handle bills, discounts and item availability.')]:
 text(38,y,title,19,'B',WHITE);para(38,y+30,desc,450,14,'#BECBD7')
c.showPage()

#5 reservations delivery
base(5,'Reservations & Delivery');kicker('BEFORE ARRIVAL. BEYOND YOUR TABLES.');heading(['Welcome them in.','Send it out.'],146,38)
phone_image(TMP/'booking.png',48,319,198)
text(48,755,'Actual Tableeqr booking screen',9,'R',MUTED)
text(278,331,'Reservations',23,'B');para(278,372,'Table bookings, seating preferences, waitlist and preorders.',218,15)
line(278,479,502,479)
icon('delivery',278,508,35,'#16816F');text(278,563,'Direct delivery',23,'B');para(278,605,'Configure service areas and delivery charges. Assign riders and keep guests updated.',218,15)
box(38,802,464,73,PALE,12);text(57,820,'Your restaurant. Your service.',19,'B');para(57,849,'Manage dine-in and direct orders in one platform.',425,13)
c.showPage()

#6 hotel
base(6,'Hotel Rooms');kicker('BEYOND THE RESTAURANT');heading(['Better service,','room by room.'],146,42)
para(38,255,'Connect your reception, room guests and service team.',440,17)
# Hotel corridor, editorial illustration
box(38,337,464,221,NAVY,18)
for x,num,active in [(68,'201',False),(218,'202',True),(368,'203',False)]:
 box(x,365,104,163,'#2C465A' if not active else '#245E5A',7);box(x+13,380,78,132,'#223A4C' if not active else '#1C4C49',4);text(x+32,394,num,18,'B',TEAL if active else '#CFDCE4');circle(x+78,460,3,GOLD)
box(190,514,160,32,TEAL,16);text(211,525,'SERVICE REQUEST SENT',10,'B',NAVY)
feature(598,'Room QR & food ordering','Give guests a direct route to room service.','phone')
feature(691,'Housekeeping & guest requests','Route requests for cleaning, towels and essentials.','room')
feature(784,'Reception & stay management','Manage check-in, check-out and room service bills.','check')
c.showPage()

#7 owner
base(7,'Owner Control');kicker('THE BUSINESS BEHIND THE SERVICE');heading(['Know what is','happening.'],146,44)
para(38,261,'Keep the daily details visible, from sales to stock.',440,17)
# flat report-style editorial layout
box(38,342,464,186,NAVY,16);text(61,365,'A CLEARER VIEW OF YOUR BUSINESS',11,'B',TEAL)
for x,h in [(65,33),(108,55),(151,40),(194,79),(237,65),(280,99),(323,84),(366,117),(409,105)]:box(x,502-h,25,h,'#35D5BD' if x>300 else '#376076',5)
text(61,542,'Illustrative chart - no customer performance data',9,'R',MUTED)
feature(590,'Sales & business reports','Review sales, items, staff activity and day-close reports.','chart')
feature(683,'Inventory & recipes','Track ingredients, purchases, consumption and low stock.','check')
feature(776,'Team & outlet controls','Manage staff permissions and multiple outlets.','table')
c.showPage()

#8 CTA
base(8,'Get Started',True);kicker('TABLEEQR  /  BETA EARLY ACCESS',112,True);heading(['See Tableeqr','in action.'],160,50,True)
para(38,295,'Bring your restaurant or hotel.<br/>We will walk you through your service flow.',450,19,'#BECBD7',29)
box(163,415,214,214,WHITE,24)
url='https://wa.me/916367828788?text=Hi%20Tableeqr%2C%20I%20would%20like%20a%20beta%20demo.'
qr_draw(url,180,432,180);c.linkURL(url,(163,H-629,377,H-415),relative=0)
text(172,655,'SCAN TO REQUEST A DEMO',12,'B',TEAL)
box(38,710,464,62,TEAL,13);text(126,729,'WhatsApp  +91 63678 28788',20,'B',NAVY);c.linkURL(url,(38,H-772,502,H-710),relative=0)
text(203,800,'tableqr.in',21,'B',WHITE);c.linkURL('https://tableqr.in',(195,H-827,350,H-790),relative=0)
text(98,854,'Restaurants  /  Cafes  /  Hotels',17,'R','#BECBD7')
c.showPage();c.save();print(OUT)
