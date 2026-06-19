# SBB Manpower Dashboard (Live Google Sheets + Vercel)

แดชบอร์ดกำลังพลภาคสนาม SBB + สรรหารายวัน — ดึงข้อมูลสดจาก Google Sheets ทุกครั้งที่เปิดหน้าเว็บ ไม่ต้องอัปโหลดไฟล์ Excel ซ้ำอีกต่อไป

มี 3 แท็บเหมือนเวอร์ชันเดิม: **กำลังพล** (roster ตามทีม) / **Daily สรรหา** (รายชื่อรายวัน + ตารางสรุปผู้สรรหา) / **รีพอท** (ทีมขาดกำลังพล, ไม่มีม้าเร็ว, สรุปตำแหน่ง)

---

## โครงสร้างโปรเจกต์

```
sbb-dashboard/
├── api/
│   └── data.js        ← Vercel serverless function: ดึง CSV จาก Google Sheets แล้วแปลงเป็น JSON
├── index.html          ← หน้าเว็บทั้งหมด (เดิมฝัง JSON ไว้ในไฟล์ ตอนนี้ fetch('/api/data') แทน)
├── package.json
├── vercel.json
├── .env.example
└── .gitignore
```

ไม่มี build step — เป็น static HTML + 1 serverless function ล้วน ๆ ไม่ต้องใช้ React/Vite ก็ทำงานได้ deploy เร็ว

---

## ก่อน Deploy: เช็ค Google Sheet

Sheet ID ที่ใช้อยู่ตอนนี้ (ฝังไว้เป็นค่า default ในโค้ดแล้ว ไม่ต้องตั้งอะไรเพิ่ม):
```
1HoDVHBNXi8F87ZsQF-ELwsQ2DtWDc2fEVf6CRFA-X2Q
```
พร้อม 3 แท็บ: SBB (gid=0), ฝึกงาน (gid=904170512), กำลังพลที่ต้องการ (gid=1227635779)

**สำคัญ**: ต้องตั้งค่าแชร์เป็น **"Anyone with the link" → Viewer** (ทดสอบแล้วว่าตอนนี้เปิดอยู่) มิฉะนั้น `/api/data` จะดึงข้อมูลไม่ได้ เพราะระบบดึงแบบ public CSV export ไม่ผ่าน API key/OAuth

ถ้าจะเปลี่ยนไปใช้ Sheet อื่น ดูหัวข้อ [เปลี่ยน Google Sheet ที่ใช้](#เปลี่ยน-google-sheet-ที่ใช้) ด้านล่าง

---

## ขั้นตอน Deploy

### 1. Push ขึ้น GitHub

```bash
cd sbb-dashboard
git init
git add .
git commit -m "Initial commit: SBB manpower dashboard"
git branch -M main
git remote add origin https://github.com/<your-username>/<repo-name>.git
git push -u origin main
```

(สร้าง repo เปล่าบน GitHub ก่อนถ้ายังไม่มี — ไปที่ github.com/new ตั้งชื่อ repo แล้ว **ไม่ต้อง** ติ๊ก "Add README" เพื่อไม่ให้ชนกับไฟล์ที่มีอยู่)

### 2. Import เข้า Vercel

1. ไปที่ [vercel.com/new](https://vercel.com/new)
2. เลือก **Import Git Repository** แล้วเลือก repo ที่เพิ่ง push ไป
3. หน้า Configure Project:
   - **Framework Preset**: เลือก **Other** (ไม่ต้องเลือก Next.js/Vite เพราะเราไม่ได้ใช้ framework ใด ๆ)
   - **Root Directory**: ปล่อยค่า default (`.`)
   - **Build Command** / **Output Directory**: ปล่อยว่าง (ไม่ต้อง build)
4. กด **Deploy**

รอประมาณ 30-60 วินาที Vercel จะ build เสร็จและให้ URL กลับมา (เช่น `https://sbb-dashboard-xxxx.vercel.app`)

### 3. ทดสอบ

เปิด URL ที่ได้ → ควรเห็นหน้า "กำลังโหลดข้อมูลจาก Google Sheets..." สั้น ๆ แล้วเข้าสู่แดชบอร์ดพร้อมข้อมูลสด

ถ้าขึ้นหน้า error แดง "โหลดข้อมูลไม่สำเร็จ" ดูหัวข้อ [แก้ปัญหา](#แก้ปัญหา) ด้านล่าง

---

## วิธีอัปเดตข้อมูลหลัง Deploy

ไม่ต้อง deploy ใหม่เลย — แค่แก้ข้อมูลใน Google Sheet ตามปกติ แล้ว:

- กดปุ่ม **"⟳ รีเฟรชข้อมูล"** มุมขวาบนของเว็บ เพื่อดึงข้อมูลล่าสุดทันที, หรือ
- รีโหลดหน้าเว็บใหม่ (ข้อมูลแคชไว้ที่ Vercel Edge 5 นาที ถ้าต้องการเห็นข้อมูลสด ๆ ทันทีให้กดปุ่มรีเฟรชในหน้าเว็บแทนการรอ)

---

## เปลี่ยน Google Sheet ที่ใช้

ถ้าต้องการเปลี่ยนไปอีก Sheet หนึ่ง (หรือเปลี่ยน gid ของแท็บ) โดยไม่แก้โค้ด:

1. ไปที่ Vercel Dashboard → โปรเจกต์นี้ → **Settings → Environment Variables**
2. เพิ่มตัวแปร (ดูชื่อและตัวอย่างใน `.env.example`):
   - `SHEET_ID` — ID ของ Sheet (ส่วนระหว่าง `/d/` กับ `/edit` ใน URL)
   - `GID_SBB`, `GID_PIPELINE`, `GID_REQUIRED` — gid ของแต่ละแท็บ
3. กด **Redeploy** (Vercel → Deployments → ... → Redeploy) เพื่อให้ตัวแปรใหม่มีผล

---

## แก้ปัญหา

**"โหลดข้อมูลไม่สำเร็จ" / HTTP 403 ใน error message**
→ Google Sheet ยังไม่ได้แชร์เป็น public ไปที่ Sheet → ปุ่ม **Share** มุมขวาบน → **General access** → เปลี่ยนเป็น **Anyone with the link** → role **Viewer**

**ตัวเลขในแดชบอร์ดดูผิดเพี้ยน / คอลัมน์ไม่ตรง**
→ ตรวจว่าหัวคอลัมน์ในแต่ละแท็บของ Google Sheet ยังตรงตามนี้:
- **SBB**: code, name, position, start_date, last_date, zone, region, head, reason, Workplace
- **ฝึกงาน**: วันที่สรรหา, ชื่อ นามสกุล, ตำแหน่ง, ทีมย่อย, สถานะรายงานตัว, สถานะฝึกงาน, Owner
- **กำลังพลที่ต้องการ**: ภูมิภาค, ทีมย่อย, หัวหน้าทีมเชียร์, กำลังพลที่ต้องการ, สถานะทีม (คอลัมน์ สถานะทีม ถ้าไม่มีจะถือว่าทุกทีม Active)

**วันที่ในชีต "ฝึกงาน" ต้องเป็นรูปแบบไหน**
→ ระบบอ่านรูปแบบ `D/M/YYYY` (เช่น 27/1/2026) ตามที่ Google Sheets แสดงผลตอนนี้ ถ้าเปลี่ยนรูปแบบการแสดงผลของคอลัมน์วันที่ในชีตเป็นแบบอื่น (เช่น YYYY-MM-DD) ระบบจะอ่านวันที่ผิดหรือข้ามแถวนั้นไป

**กด "⟳ รีเฟรชข้อมูล" แล้วไม่เห็นการเปลี่ยนแปลง**
→ Vercel cache ไว้ฝั่ง edge 5 นาที ปุ่มรีเฟรชใช้ `cache: 'no-store'` ฝั่ง browser แล้วแต่ edge cache ของ Vercel เองอาจยังไม่หมดอายุ รอ 1-2 นาทีแล้วลองใหม่ หรือลด `s-maxage` ใน `api/data.js` ถ้าต้องการข้อมูลสดทันทีทุกครั้ง (แลกกับโหลดช้าลงเล็กน้อยเพราะดึงจาก Google ทุกครั้ง)

**กำลังพลที่ต้องการ (เป้าหมายรายทีม) ที่แก้ในหน้าเว็บหายไปหลังปิด browser**
→ ค่าที่แก้ไขเก็บไว้ใน `localStorage` ของเบราว์เซอร์เครื่องนั้น ๆ เท่านั้น (ไม่ได้เขียนกลับไปที่ Google Sheet) ถ้าเปลี่ยนเครื่อง/เบราว์เซอร์ หรือล้าง browser data จะกลับไปใช้ค่าเริ่มต้นจากชีต "กำลังพลที่ต้องการ"

---

## หมายเหตุทางเทคนิค

- ข้อมูลทั้งหมดดึงจาก Google Sheets export endpoint (`/export?format=csv&gid=...`) ฝั่ง server (ใน `api/data.js`) ไม่ใช่ฝั่ง browser จึงไม่ติดปัญหา CORS
- Vercel edge cache ข้อมูลไว้ 5 นาที (`s-maxage=300`) เพื่อลดโหลด Google Sheets และให้เว็บโหลดเร็ว ปุ่มรีเฟรชในหน้าเว็บ bypass cache ฝั่ง browser แต่ edge cache ของ Vercel เองจะหมดอายุตามรอบ 5 นาที
- ตรรกะการคำนวณทั้งหมด (กำลังพลปัจจุบัน/รอเข้ารายงานตัว/ฝึกงาน/สถานะ 5 ขั้น ฯลฯ) พอร์ตมาจาก Python ของเวอร์ชันก่อนหน้าแบบ 1:1 และตรวจสอบผลลัพธ์ตัวเลขแล้วว่าตรงกันทุกค่า
- ปุ่มแก้ "กำลังพลที่ต้องการ" รายทีมใช้ `localStorage` เก็บค่าที่แก้ไว้ในเบราว์เซอร์ (เดิมใช้ Claude artifact storage ซึ่งใช้ไม่ได้นอกแชท Claude)
