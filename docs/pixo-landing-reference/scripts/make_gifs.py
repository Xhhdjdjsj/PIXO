from PIL import Image, ImageDraw, ImageFont
import math, os

OUT='/mnt/data/pixo_landing_premium/assets'
os.makedirs(OUT, exist_ok=True)
W,H=720,400
BG='#0b0a10'; PANEL='#111016'; LINE='#282431'; MUTED='#8d879c'; PURPLE='#8e3dff'; LAV='#b78aff'; CYAN='#4dd8f4'; WHITE='#f5f2fc'; GREEN='#53d6a0'
FONT='/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf'
FONT_B='/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf'
def font(n,b=False): return ImageFont.truetype(FONT_B if b else FONT,n)
F8=font(8); F9=font(9); F10=font(10); F11=font(11); F12=font(12); F13=font(13); F14=font(14,True)

def rounded(d, box, r, fill, outline=None, width=1): d.rounded_rectangle(box, radius=r, fill=fill, outline=outline, width=width)
def center_text(d, xy, s, f, fill):
    b=d.textbbox((0,0),s,font=f); d.text((xy[0]-(b[2]-b[0])/2,xy[1]-(b[3]-b[1])/2),s,font=f,fill=fill)
def draw_logo(d):
    # Pixo mark + word
    rounded(d,(15,11,23,25),3,PURPLE); rounded(d,(27,10,35,18),3,PURPLE); rounded(d,(27,21,35,29),3,PURPLE)
    d.text((43,10),'Pixo',font=F12,fill=WHITE)

def atom(d,cx,cy,r=25,scale=1):
    # ellipses drawn to temp layer and rotated, crisp cyan orbit icon
    size=int(2*(r+15)*scale)
    base=Image.new('RGBA',(size*2,size*2),(0,0,0,0)); bd=ImageDraw.Draw(base)
    cx0=cy0=size
    bbox=(cx0-int(r*.52*scale),cy0-int(r*1.25*scale),cx0+int(r*.52*scale),cy0+int(r*1.25*scale))
    bd.ellipse(bbox,outline=CYAN,width=max(2,int(3*scale)))
    for angle in (48,-48):
        rot=base.rotate(angle,resample=Image.Resampling.BICUBIC,center=(cx0,cy0))
        # overlay centered
        d._image.alpha_composite(rot,(int(cx-size),int(cy-size))) if hasattr(d,'_image') else None
    # easier using separate layer
    layer=Image.new('RGBA',(W,H),(0,0,0,0)); ld=ImageDraw.Draw(layer)
    for angle in (0,48,-48):
        b=Image.new('RGBA',(int(r*3.4),int(r*3.4)),(0,0,0,0)); x=ImageDraw.Draw(b)
        x.ellipse((int(r*1.12),int(r*.35),int(r*2.28),int(r*3.05)),outline=CYAN,width=max(2,int(3*scale)))
        b=b.rotate(angle,resample=Image.Resampling.BICUBIC)
        layer.alpha_composite(b,(int(cx-b.width/2),int(cy-b.height/2)))
    layerd=ImageDraw.Draw(layer); layerd.ellipse((cx-int(5*scale),cy-int(5*scale),cx+int(5*scale),cy+int(5*scale)),fill=CYAN)
    d._image.alpha_composite(layer) if hasattr(d,'_image') else None

def draw_atom(im,cx,cy,r=25,stroke=3):
    layer=Image.new('RGBA',im.size,(0,0,0,0)); ld=ImageDraw.Draw(layer)
    for angle in (0,60,-60):
        b=Image.new('RGBA',(r*4,r*4),(0,0,0,0)); bd=ImageDraw.Draw(b)
        bd.ellipse((int(r*1.3),int(r*.35),int(r*2.7),int(r*3.65)),outline=CYAN,width=stroke)
        b=b.rotate(angle,resample=Image.Resampling.BICUBIC)
        layer.alpha_composite(b,(int(cx-b.width/2),int(cy-b.height/2)))
    ld=ImageDraw.Draw(layer); ld.ellipse((cx-5,cy-5,cx+5,cy+5),fill=CYAN)
    im.alpha_composite(layer)

def star_points(cx,cy,outer,inner,n=5,rotation=-90):
    pts=[]
    for i in range(n*2):
        a=math.radians(rotation+i*180/n); r=outer if i%2==0 else inner
        pts.append((cx+math.cos(a)*r,cy+math.sin(a)*r))
    return pts

def draw_star(d,cx,cy,r,color=PURPLE): d.polygon(star_points(cx,cy,r,r*.46),fill=color)
def draw_leaf(d,cx,cy,s,color=PURPLE):
    pts=[(cx-s*.50,cy+s*.29),(cx-s*.50,cy-s*.12),(cx-s*.20,cy-s*.48),(cx+s*.23,cy-s*.47),(cx+s*.49,cy-s*.42),(cx+s*.45,cy+.02*s),(cx+s*.18,cy+s*.39),(cx-s*.22,cy+s*.42)]
    d.polygon(pts,fill=color); d.line((cx-s*.38,cy+s*.33,cx+s*.34,cy-s*.34),fill='#d6bcff',width=3)
def draw_ring(d,cx,cy,r,color=PURPLE, width=8):
    d.ellipse((cx-r,cy-r,cx+r,cy+r),outline=color,width=width); d.ellipse((cx-r*.48,cy-r*.48,cx+r*.48,cy+r*.48),fill='#17131f')
def draw_cursor(d,x,y,click=False,label=None):
    # mouse pointer and subtle click halo
    if click: d.ellipse((x-12,y-12,x+12,y+12),outline='#b990ff',width=2)
    d.polygon([(x,y),(x,y+22),(x+5,y+16),(x+11,y+28),(x+16,y+25),(x+10,y+14),(x+19,y+13)], fill='#ffffff', outline='#21172e')
    if label:
        rounded(d,(x+19,y+6,x+19+len(label)*6+12,y+24),5,'#25202f',outline='#493760')
        d.text((x+25,y+9),label,font=F8,fill=WHITE)

def base_frame(title='Untitled project', action='Ready'):
    im=Image.new('RGBA',(W,H),BG); d=ImageDraw.Draw(im)
    # main chrome
    d.rectangle((0,0,W,38),fill=PANEL); d.line((0,37,W,37),fill=LINE,width=1)
    draw_logo(d); d.text((112,13),'/',font=F10,fill='#5f596b'); d.text((127,13),title,font=F9,fill='#d9d3e5')
    rounded(d,(618,10,707,28),8,'#17151e',outline='#302a3a'); d.ellipse((628,16,634,22),fill=GREEN); d.text((639,14),action,font=F8,fill='#bcb5ca')
    # sidebar
    d.rectangle((0,38,137,H),fill=PANEL); d.line((136,38,136,H),fill=LINE,width=1)
    d.text((13,53),'LIBRARY',font=F9,fill=WHITE); d.line((13,69,55,69),fill=PURPLE,width=2)
    for y,name,active in [(81,'orbit-kit.svg',True),(111,'shapes.svg',False),(141,'brand.svg',False)]:
        rounded(d,(9,y,127,y+24),5,'#281a3d' if active else '#17151e',outline='#3b2a52' if active else '#24212e')
        rounded(d,(15,y+6,28,y+18),3,'#7830de' if active else '#302a3a')
        d.text((34,y+8),name,font=F8,fill='#eee8f7' if active else MUTED)
    d.text((12,183),'COMPONENTS',font=F8,fill='#777085')
    # sidebar mini tiles
    for y in (197,252,307):
        rounded(d,(10,y,127,y+46),6,'#17151d',outline='#2b2634')
    d.text((17,207),'Orbit mark',font=F8,fill='#cfc8dc'); d.text((17,262),'Star shape',font=F8,fill='#cfc8dc'); d.text((17,317),'Leaf form',font=F8,fill='#cfc8dc')
    # mini colored previews
    d.ellipse((101,205,116,220),outline=CYAN,width=2); d.polygon(star_points(108,274,9,4),fill=PURPLE); draw_leaf(d,108,333,16)
    # canvas viewport and dotted grid
    d.rectangle((137,38,629,H),fill='#0b0a10')
    for xx in range(147,628,17):
        for yy in range(48,H,17): d.ellipse((xx,yy,xx+1,yy+1),fill='#26222e')
    d.rectangle((153,48,617,75),fill='#111016'); d.line((153,75,617,75),fill=LINE,width=1)
    rounded(d,(164,55,204,68),4,'#292233'); d.text((173,58),'Move',font=F8,fill='#eee8f7')
    d.text((216,58),'Select',font=F8,fill=MUTED); d.text((258,58),'Pen',font=F8,fill=MUTED)
    d.text((580,58),'100%',font=F8,fill=MUTED)
    # right inspector
    d.rectangle((629,38,W,H),fill=PANEL); d.line((629,38,629,H),fill=LINE,width=1)
    d.text((641,53),'PROPERTIES',font=F8,fill=WHITE); d.line((641,69,702,69),fill=PURPLE,width=2)
    d.text((641,83),'Selection',font=F8,fill='#7f788e')
    rounded(d,(641,96,707,117),4,'#1a1721',outline='#30293b'); d.text((647,103),'Group / 04',font=F8,fill='#d7d1e3')
    d.text((641,133),'Position',font=F8,fill='#7f788e')
    rounded(d,(641,145,672,164),4,'#1a1721',outline='#30293b'); d.text((647,151),'X 248',font=F8,fill='#c8c1d5')
    rounded(d,(678,145,707,164),4,'#1a1721',outline='#30293b'); d.text((683,151),'Y 132',font=F8,fill='#c8c1d5')
    d.text((641,181),'Fill',font=F8,fill='#7f788e'); rounded(d,(641,193,707,215),4,'#1a1721',outline='#30293b'); rounded(d,(647,199,658,210),3,PURPLE); d.text((663,201),'#8E3DFF',font=F8,fill='#c8c1d5')
    # artboard centered
    rounded(d,(220,93,566,359),2,'#100e16',outline='#2e2937')
    # tiny artboard label
    d.text((230,100),'COMPOSITION / 01',font=F8,fill='#50495e')
    # left-side status bar bottom
    rounded(d,(151,366,615,390),6,'#111016',outline='#302b39')
    d.ellipse((162,375,169,382),fill=GREEN); d.text((176,374),'All changes saved',font=F8,fill='#a7a0b5'); d.text((305,374),'·',font=F8,fill='#5d566b'); d.text((317,374),'4 objects',font=F8,fill='#a7a0b5')
    return im

def selection(d, box, label='Star / vector'):
    x1,y1,x2,y2=box
    d.rectangle(box,outline=LAV,width=1)
    for x in (x1,x2):
        for y in (y1,y2): d.rectangle((x-3,y-3,x+3,y+3),fill='#fff',outline=PURPLE,width=1)
    rounded(d,(x1,y1-18,x1+len(label)*5.2+14,y1-3),3,PURPLE)
    d.text((x1+5,y1-16),label,font=F8,fill='white')

def frame_drag(t):
    im=base_frame(action='Moving object'); d=ImageDraw.Draw(im)
    # composition components already on artboard
    draw_atom(im,330,195,19,2)
    d=ImageDraw.Draw(im); draw_star(d,435,144,24); draw_ring(d,295,289,16,CYAN,5)
    # target and moving leaf track
    start=(344,269); end=(455,257)
    if t < 0.24: p=t/0.24; x=start[0]+(315-start[0])*p; y=start[1]+(244-start[1])*p
    elif t < 0.72: p=(t-.24)/.48; x=315+(end[0]-315)*p; y=244+(end[1]-244)*p
    else: x,y=end
    # target ghost / dotted landing target
    if t>=.24:
        for k in range(4):
            xx=end[0]-26 + k*14; d.ellipse((xx, end[1]-1,xx+2,end[1]+1),fill='#51416a')
    draw_leaf(d,int(x),int(y),40)
    if t>.12: selection(d,(int(x-28),int(y-27),int(x+28),int(y+26)),'leaf / vector')
    if t>.72:
        rounded(d,(372,322,538,347),7,'#221935',outline='#4b3470'); d.ellipse((383,331,391,339),fill=GREEN); d.text((399,330),'Object repositioned',font=F9,fill='#e5dcf4')
    # cursor follows pointer
    if t<.2: cx,cy=300+25*t/.2,225+12*t/.2
    elif t<.74: p=(t-.2)/.54; cx,cy=325+130*p,239+7*p
    else: cx,cy=455,246
    draw_cursor(d,int(cx),int(cy),click=(.17<t<.27),label='Drag')
    return im.convert('RGB')

def frame_duplicate(t):
    im=base_frame(action='Duplicate layer'); d=ImageDraw.Draw(im)
    draw_atom(im,319,185,17,2); d=ImageDraw.Draw(im)
    draw_leaf(d,470,276,35); draw_ring(d,290,288,14,CYAN,4)
    # original star centered; clone moves to right
    draw_star(d,367,170,27,PURPLE)
    if t<.30: clone_x,clone_y=367,170; alpha=0
    elif t<.75:
        p=(t-.30)/.45; clone_x=367+85*p; clone_y=170+18*p; alpha=1
    else: clone_x,clone_y=452,188; alpha=1
    if alpha:
        # faint duplicate silhouette where clone starts
        d.polygon(star_points(int(clone_x),int(clone_y),27,12),fill='#a96cff')
        selection(d,(int(clone_x-31),int(clone_y-31),int(clone_x+31),int(clone_y+31)),'Star copy')
    else:
        selection(d,(336,139,398,201),'Star / vector')
    # keycap hint
    if t>=.22:
        rounded(d,(263,315,400,344),8,'#20182f',outline='#483363'); rounded(d,(271,321,319,338),4,'#302441',outline='#5f477c'); center_text(d,(295,329),'Ctrl',F9,WHITE); center_text(d,(331,329),'+',F10,'#b9adc9'); rounded(d,(342,321,390,338),4,'#302441',outline='#5f477c'); center_text(d,(366,329),'D',F9,WHITE)
    if t>.72:
        rounded(d,(410,315,546,344),8,'#221935',outline='#4b3470'); d.ellipse((420,325,428,333),fill=GREEN); d.text((436,323),'Duplicated',font=F9,fill='#e5dcf4')
    if t<.22: cx,cy=333+20*t/.22,155+8*t/.22
    elif t<.8: p=(t-.22)/.58; cx,cy=353+99*p,159+35*p
    else: cx,cy=453,195
    draw_cursor(d,int(cx),int(cy),click=(.18<t<.28),label='Duplicate')
    return im.convert('RGB')

def frame_compose(t):
    im=base_frame(action='Build composition'); d=ImageDraw.Draw(im)
    # selected components drift from sidebar/toolbar to artboard
    # faint final positions
    targets=[(315,174,'atom'),(437,160,'star'),(322,280,'ring'),(458,278,'leaf')]
    progress=min(1,max(0,t*1.35))
    for i,(tx,ty,kind) in enumerate(targets):
        delay=i*.15
        p=min(1,max(0,(t-delay)/max(.01,1-delay)))
        sx,sy= (70,219+i*17)
        x=sx+(tx-sx)*p; y=sy+(ty-sy)*p
        if p>0:
            if kind=='atom': draw_atom(im,int(x),int(y),15,2)
            elif kind=='star': draw_star(d,int(x),int(y),19,PURPLE)
            elif kind=='ring': draw_ring(d,int(x),int(y),12,CYAN,4)
            elif kind=='leaf': draw_leaf(d,int(x),int(y),29)
            d=ImageDraw.Draw(im)
            if p<1:
                d.ellipse((int(x-19),int(y-19),int(x+19),int(y+19)),outline='#b58bff',width=1)
    d=ImageDraw.Draw(im)
    if t>.82:
        rounded(d,(330,315,503,344),8,'#221935',outline='#4b3470'); d.ellipse((341,325,349,333),fill=GREEN); d.text((357,323),'Composition ready',font=F9,fill='#e5dcf4')
    # cursor drag from sidebar to new components
    if t<.22: cx,cy=75,226
    elif t<.72: p=(t-.22)/.5; cx,cy=75+240*p,226-52*p
    else: cx,cy=315,174
    draw_cursor(d,int(cx),int(cy),click=(.18<t<.28),label='Drag to canvas')
    return im.convert('RGB')

def make_gif(fn, builder, n=40, duration=85):
    frames=[]
    for i in range(n):
        t=i/(n-1)
        fr=builder(t)
        # normalize quantization across frames for crisp looping file
        frames.append(fr.convert('P',palette=Image.Palette.ADAPTIVE,colors=128))
    path=os.path.join(OUT,fn)
    frames[0].save(path,save_all=True,append_images=frames[1:],duration=duration,loop=0,optimize=True,disposal=2)
    print(path,os.path.getsize(path))

make_gif('pixo-move-object.gif',frame_drag,40,85)
make_gif('pixo-duplicate-object.gif',frame_duplicate,40,85)
make_gif('pixo-build-composition.gif',frame_compose,44,85)
