const express = require('express');
const http = require('http');
const { Server } = require("socket.io");
const fs = require('fs');
const path = require('path');
const multer = require('multer');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const HISTORY_FILE = 'chat_history.json';
const ADMIN_PASSWORD = "089963"; // PASSWORD DI SINI

// Load chat history
let chatHistory = [];
if (fs.existsSync(HISTORY_FILE)) {
    chatHistory = JSON.parse(fs.readFileSync(HISTORY_FILE));
}

// Pastikan folder uploads ada
if (!fs.existsSync('uploads')){ fs.mkdirSync('uploads'); }

app.use(express.static('public'));
app.use('/uploads', express.static('uploads'));

// Tampilan utama
app.get('/', (req, res) => { res.sendFile(path.join(__dirname, 'index.html')); });

const storage = multer.diskStorage({
    destination: './uploads/',
    filename: (req, file, cb) => {
        cb(null, Date.now() + path.extname(file.originalname));
    }
});
const upload = multer({ storage });

app.post('/upload-file', upload.single('file'), (req, res) => {
    const fileUrl = `/uploads/${req.file.filename}`;
    const data = {
        name: req.body.name,
        color: req.body.color,
        pic: req.body.pic,
        url: fileUrl,
        type: path.extname(req.file.filename) === '.mp3' ? 'audio' : 'image',
        fileName: req.file.originalname
    };
    io.emit('chat message', data);
    chatHistory.push(data);
    fs.writeFileSync(HISTORY_FILE, JSON.stringify(chatHistory));
    res.send(fileUrl);
});

app.post('/upload-profile', upload.single('file'), (req, res) => {
    res.send(`/uploads/${req.file.filename}`);
});

// --- LOGIKA UTAMA SOCKET.IO ---
io.on('connection', (socket) => {
    console.log('User terhubung');
    socket.emit('load history', chatHistory);

    // 1. CEK LOGIN ADMIN DENGAN PASSWORD
    socket.on('register user', (data) => {
        socket.username = data.username;
        
        if (data.username === "Admin") {
            if (data.password === ADMIN_PASSWORD) {
                console.log("Admin berhasil login dengan password");
                socket.isAdmin = true; // Tandai socket ini sebagai admin
                socket.emit('loginResult', { success: true, message: "Selamat Datang Admin" });
            } else {
                console.log("Password admin salah");
                socket.isAdmin = false;
                socket.emit('loginResult', { success: false, message: "Password Salah!" });
                
                // --- KODE ANTI-TEMBUS ---
                socket.disconnect(); // TENDANG USER JIKA PASSWORD SALAH
                return; // STOP LOGIKA DI SINI
                // -------------------------
            }
        } else {
            socket.isAdmin = false;
            console.log(data.username + " masuk ke chat");
        }
    });

    socket.on('chat message', (data) => {
        chatHistory.push(data);
        if (chatHistory.length > 100) chatHistory.shift();
        fs.writeFileSync(HISTORY_FILE, JSON.stringify(chatHistory));
        io.emit('chat message', data);
    });

    socket.on('typing', (user) => { socket.broadcast.emit('typing', user); });
    socket.on('stop typing', () => { socket.broadcast.emit('stop typing'); });
    socket.on('disconnect', () => { console.log('User terputus'); });
});

// --- PERINTAH TERMINAL (HANYA ADMIN) ---
// (Bagian ini tidak perlu diubah, kodenya sudah benar)
process.stdin.on('data', (data) => {
    const input = data.toString().trim();
    if (input.startsWith('/')) {
        const parts = input.split(' ');
        const command = parts[0];
        const args = parts.slice(1);

        // Cari socket yang admin (asumsi 1 admin aktif via terminal)
        const adminSocket = Object.values(io.sockets.sockets).find(s => s.isAdmin);

        switch (command) {
            case '/kick':
                if (!adminSocket) return console.log("Harus login admin dulu di web!");
                if (args[0]) {
                    io.emit('kick user', args[0]);
                    console.log(`User ${args[0]} dikick.`);
                }
                break;
            case '/clear':
                if (!adminSocket) return console.log("Harus login admin dulu di web!");
                fs.writeFileSync(HISTORY_FILE, JSON.stringify([]));
                chatHistory = [];
                io.emit('clear chat');
                console.log('Chat dihapus.');
                break;
            case '/announce':
                if (!adminSocket) return console.log("Harus login admin dulu di web!");
                if (args.length > 0) {
                    io.emit('chat message', {
                        name: "📢 ADMIN",
                        msg: args.join(' '),
                        pic: "/uploads/default.png",
                        color: "#ff4500",
                        type: 'text'
                    });
                }
                break;
            case '/off':
                console.log("Mematikan server...");
                io.emit('chat message', { name: "System", msg: "Server dimatikan.", color: "red", type: 'text' });
                setTimeout(() => { process.exit(0); }, 1000);
                break;
            default:
                console.log('Perintah salah atau butuh akses admin!');
                break;
        }
    } else {
        // Chat Biasa dari Terminal
        io.emit('chat message', {
            name: "Admin",
            msg: input,
            pic: "/uploads/default.png",
            color: "#ff0000",
            type: 'text'
        });
    }
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server berjalan di port ${PORT}`);
});
