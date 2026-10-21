from playwright.sync_api import sync_playwright
from pathlib import Path
import base64
root=Path('/mnt/data/pixo_landing_premium')
html=(root/'index.html').read_text()
for name in ['pixo-move-object.gif','pixo-duplicate-object.gif','pixo-build-composition.gif']:
    data=base64.b64encode((root/'assets'/name).read_bytes()).decode()
    html=html.replace(f'assets/{name}',f'data:image/gif;base64,{data}')
with sync_playwright() as p:
    browser=p.chromium.launch(headless=True, executable_path='/usr/bin/chromium', args=['--no-sandbox','--disable-dev-shm-usage','--disable-gpu'])
    page=browser.new_page(viewport={'width':1440,'height':1000},device_scale_factor=1)
    errors=[]
    page.on('pageerror',lambda e:errors.append(str(e)))
    page.set_content(html,wait_until='load',timeout=15000)
    page.wait_for_timeout(600)
    print('title:',page.title())
    print('motion cards:',page.locator('.motion-card').count())
    print('GIF status:',page.locator('.motion-preview img').evaluate_all('(imgs)=>imgs.map(i=>({complete:i.complete,w:i.naturalWidth,h:i.naturalHeight}))'))
    print('hero:',page.locator('#demoStatus').inner_text(),page.locator('#demoCaption').inner_text())
    page.wait_for_timeout(2600)
    print('hero after 2.6s:',page.locator('#demoStatus').inner_text(),page.locator('#demoCaption').inner_text())
    # scroll through for reveal observers
    for y in range(0,page.locator('body').evaluate('(e)=>e.scrollHeight'),700):
        page.evaluate('(y)=>window.scrollTo(0,y)',y); page.wait_for_timeout(60)
    page.evaluate('document.querySelectorAll(".reveal").forEach(e => e.classList.add("visible")); window.scrollTo(0,0)'); page.wait_for_timeout(250)
    page.screenshot(path=str(root/'preview-desktop.png'),full_page=True,animations='allow')
    page.set_viewport_size({'width':390,'height':844})
    page.wait_for_timeout(300)
    page.screenshot(path=str(root/'preview-mobile.png'),full_page=True,animations='allow')
    print('mobile columns:',page.locator('.motion-grid').evaluate('(e)=>getComputedStyle(e).gridTemplateColumns'))
    print('body heights desktop/mobile captured; errors:',errors)
    browser.close()
