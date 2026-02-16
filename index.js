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
const ADMIN_PASSWORD = "089963"; // PASSWORD ADMIN

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

    // 2. PROSES CHAT DAN COMMAND SLASH (/)
    socket.on('chat message', (data) => {
        // Cek apakah pesan adalah command slash
        if (data.msg.startsWith('/')) {
            if (!socket.isAdmin) {
                console.log(data.name + " mencoba command tapi bukan admin");
                return; // Abaikan kalau bukan admin
            }

            const parts = data.msg.split(' ');
            const command = parts[0];
            const args = parts.slice(1);

            switch (command) {
                case '/clear':
                    fs.writeFileSync(HISTORY_FILE, JSON.stringify([]));
                    chatHistory = [];
                    io.emit('clear chat');
                    console.log('Chat dihapus oleh ' + data.name);
                    break;
                case '/announce':
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
                default:
                    console.log('Command tidak dikenal');
                    break;
            }
            return; // Jangan kirim command-nya sebagai pesan chat
        }

        // Chat Biasa
        chatHistory.push(data);
        if (chatHistory.length > 100) chatHistory.shift();
        fs.writeFileSync(HISTORY_FILE, JSON.stringify(chatHistory));
        io.emit('chat message', data);
    });

    socket.on('typing', (user) => { socket.broadcast.emit('typing', user); });
    socket.on('stop typing', () => { socket.broadcast.emit('stop typing'); });
    socket.on('disconnect', () => { console.log('User terputus'); });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server berjalan di port ${PORT}`);
});
