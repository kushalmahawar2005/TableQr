from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle, PageBreak
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib import colors
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
pdfmetrics.registerFont(TTFont('Arial','/System/Library/Fonts/Supplemental/Arial.ttf'))
pdfmetrics.registerFont(TTFont('ArialBold','/System/Library/Fonts/Supplemental/Arial Bold.ttf'))
OUT='output/pdf/Tableeqr-Pricing-and-Features.pdf'
styles=getSampleStyleSheet()
for n in ['Normal','BodyText']: styles[n].fontName='Arial'; styles[n].fontSize=9; styles[n].leading=13
styles.add(ParagraphStyle(name='TitleX',fontName='ArialBold',fontSize=27,leading=32,textColor=colors.HexColor('#133e31'),spaceAfter=12))
styles.add(ParagraphStyle(name='SectionX',fontName='ArialBold',fontSize=14,leading=19,spaceBefore=15,spaceAfter=9,textColor=colors.HexColor('#133e31')))
styles.add(ParagraphStyle(name='SmallX',fontName='Arial',fontSize=8,leading=11,textColor=colors.HexColor('#52615b')))
story=[]
def p(t,style='Normal'): return Paragraph(t.replace("₹", "Rs. ").replace("\n", "<br/>"),styles[style])
def title(k,t): story.extend([p(k,'SmallX'),Spacer(1,9),p(t,'TitleX')])
def section(t):story.append(p(t,'SectionX'))
def table(rows,widths):
 data=[[p(str(c)) for c in row] for row in rows]
 t=Table(data,colWidths=widths,repeatRows=1,hAlign='LEFT')
 t.setStyle(TableStyle([('BACKGROUND',(0,0),(-1,0),colors.HexColor('#dfeee6')),('ROWBACKGROUNDS',(0,1),(-1,-1),[colors.white,colors.HexColor('#f4f7f5')]),('VALIGN',(0,0),(-1,-1),'TOP'),('LEFTPADDING',(0,0),(-1,-1),9),('RIGHTPADDING',(0,0),(-1,-1),9),('TOPPADDING',(0,0),(-1,-1),6),('BOTTOMPADDING',(0,0),(-1,-1),6),('LINEBELOW',(0,0),(-1,0),1,colors.HexColor('#a7cbb9'))]))
 story.append(t)
def note(t):story.extend([Spacer(1,9),p(t,'SmallX')])
title('TABLEEQR  /  PRICING & PRODUCT PLAN  /  29 OCTOBER 2026','Simple plans.<br/>One connected business.')
story.append(p('Agreed pricing and planned features. Internal planning reference; implementation is pending.'))
section('Monthly plans - one outlet included')
table([['Feature','Base\n₹699/month','Growth\n₹1,299/month','Advanced\n₹2,200/month'],['Menu, photos, sizes & Half/Full pricing','Included','Included','Included'],['Guest QR orders, owner/counter billing','Included','Included','Included'],['Kitchen display, order status & alerts','Included','Included','Included'],['Cash/UPI records, pay now/later, dues','Included','Included','Included'],['Delivery/pickup where enabled','Included','Included','Included'],['Staff management','Included','Included','Included'],['Reports','Basic sales & payments','Detailed','Detailed + outlet comparison'],['Inventory','Stock + low-stock alerts','Purchase, usage & wastage','Recipe costing + detailed controls'],['Waiter App','Paid add-on','Included','Included'],['Reservations + party booking','Paid add-on','Paid add-on','Included'],['Rider assignment/tracking','Paid add-on','Paid add-on','Included']],[185,103,103,112])
note('Business type controls the relevant screens. Disabled features must be hidden from dashboard cards, shortcuts and navigation. Included capabilities are not billed again as add-ons.')
story.append(PageBreak())
title('TABLEEQR  /  BILLING & ONBOARDING','Setup, outlets & savings')
section('Remote setup - one-time charges')
table([['Item','Price / rule'],['First outlet setup','₹4,999 one-time'],['Each additional outlet setup','₹1,500 one-time'],['Onboarding','Remote configuration and training by the Tableeqr team'],['Hardware','Not provided'],['First month','Selected plan, extra outlets and selected feature add-ons are free'],['Free period starts','On go-live, after setup is complete'],['Recurring charges start','After the first free month ends'],['GST on subscription','No extra GST is being added under the agreed launch pricing']],[192,311])
section('Monthly add-ons')
table([['Add-on','Monthly price'],['Each extra outlet - any plan','₹400 per extra outlet'],['Waiter App - Base only','₹299 per outlet'],['Reservations + party booking - Base/Growth','₹299 per outlet'],['Rider assignment/tracking - Base/Growth','₹399 per outlet']],[345,158])
section('Advance subscription discounts')
table([['Payment period','Discount'],['1 month','0%'],['3 months together','8%'],['6 months together','12%'],['12 months together','18%']],[345,158])
note('Discounts apply to the plan + extra-outlet subscription total. Setup fees are excluded. Discount treatment for paid feature add-ons is still to be decided. The initial free month is separate from paid billing periods. All outlets share one combined subscription bill.')
story.append(PageBreak())
title('TABLEEQR  /  BUSINESS CATEGORIES','Built around how they work')
table([['Category','Relevant workflow'],['Cloud Kitchen','Delivery/pickup orders, kitchen and billing. Hide tables, live floor, table reservations and waitlist.'],['Café','Table QR orders, counter billing and kitchen; optional delivery/pickup.'],['Restaurant','Tables/live floor, QR orders, counter billing and kitchen; optional delivery/pickup.'],['Hotel','Rooms, guest name/phone at check-in, pay-now/pay-at-checkout choice, room QR orders and outstanding order bill at checkout. Hide dining tables/floor.'],['Restaurant / Café + Hotel','Rooms and dining tables together, with kitchen, orders and billing.']],[160,343])
note('Inventory, reports and staff features follow the selected plan. Reservations and party booking are enabled by the admin team when required and entitled. Hotel scope currently covers room orders, not room rent, hourly/nightly rates, advance room bookings or MakeMyTrip/Booking.com integrations.')
section('Example: Base + two outlets + Waiter App on both')
table([['Payment','Amount'],['One-time setup: ₹4,999 + ₹1,500','₹6,499'],['First month recurring charges','₹0'],['From month two: ₹699 + ₹400 + (₹299 × 2)','₹1,697/month']],[345,158])
section('Agreed interface improvements')
for text in ['Hide disabled features everywhere, including cards, quick actions and navigation.','Remove the mobile header question-mark tour button.','Allow sizes/Half-Full and separate prices while creating a new dish.','Show the tenant logo and brand name in the header; use brand initials if no logo is uploaded. Put owner details in the profile menu.','Owner setup checklist has already been removed; the team handles onboarding remotely.']:
 story.extend([p('• '+text),Spacer(1,6)])
note('Commercial details still to specify: feature-add-on discount rules and setup payment timing. This document records the agreed product/pricing direction, not a completed deployment.')
def footer(c,d):
 c.setStrokeColor(colors.HexColor('#dfe7e2'));c.line(46,43,549,43);c.setFont('Arial',8);c.setFillColor(colors.HexColor('#52615b'));c.drawString(46,30,'Tableeqr | Pricing & features | 29 October 2026');c.drawRightString(549,30,str(d.page))
SimpleDocTemplate(OUT,pagesize=(595.28,841.89),leftMargin=46,rightMargin=46,topMargin=40,bottomMargin=55).build(story,onFirstPage=footer,onLaterPages=footer)
print(OUT)
