const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const http = require('http');
const WebSocket = require('ws');
const multer = require('multer');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

app.get('/', (req, res) => {
res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Configuração do multer para upload de arquivos
const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        const uploadDir = './uploads';
        if (!fs.existsSync(uploadDir)) {
            fs.mkdirSync(uploadDir, { recursive: true });
        }
        cb(null, uploadDir);
    },
    filename: function (req, file, cb) {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, file.fieldname + '-' + uniqueSuffix + path.extname(file.originalname));
    }
});

const upload = multer({ 
    storage: storage,
    limits: {
        fileSize: 10 * 1024 * 1024
    },
    fileFilter: function (req, file, cb) {
        if (file.mimetype.startsWith('image/') || file.mimetype.startsWith('video/')) {
            cb(null, true);
        } else {
            cb(new Error('Apenas imagens e vídeos são permitidos!'), false);
        }
    }
});

// Armazenamento em memória para WebSocket e chats
const chatConnections = new Map();
let activeChats = [];

// WebSocket para chat em tempo real
wss.on('connection', (ws, req) => {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const chatId = url.searchParams.get('chatId');
    const userType = url.searchParams.get('userType') || 'client';
    
    if (chatId) {
        if (!chatConnections.has(chatId)) {
            chatConnections.set(chatId, new Set());
        }
        
        ws.userType = userType;
        ws.chatId = chatId;
        
        chatConnections.get(chatId).add(ws);
        
        console.log(`🔗 ${userType.toUpperCase()} conectado ao chat ${chatId}`);
    }

    ws.on('close', () => {
        if (chatId && chatConnections.has(chatId)) {
            chatConnections.get(chatId).delete(ws);
            if (chatConnections.get(chatId).size === 0) {
                chatConnections.delete(chatId);
            }
        }
    });

    ws.on('message', (data) => {
        try {
            const message = JSON.parse(data);
            
            if (message.type === 'chat_message' && chatId) {
                broadcastToChat(chatId, {
                    type: 'new_message',
                    message: message.data,
                    sender: userType
                });
            }
        } catch (error) {
            console.error('❌ Erro ao processar mensagem WebSocket:', error);
        }
    });
});

function broadcastToChat(chatId, message) {
    if (chatConnections.has(chatId)) {
        chatConnections.get(chatId).forEach(client => {
            if (client.readyState === WebSocket.OPEN) {
                client.send(JSON.stringify(message));
            }
        });
    }
}

// Rotas da API

// Servir produtos
app.get('/produtos', (req, res) => {
    try {
        const produtosPath = path.join(__dirname, 'data/produtos.json');
        if (fs.existsSync(produtosPath)) {
            const produtos = JSON.parse(fs.readFileSync(produtosPath, 'utf8'));
            res.json(produtos);
        } else {
            const defaultProducts = [
                {
                    id: 1,
                    nome: "Steel Brainrot Premium",
                    preco: 49.99,
                    preco_original: 79.99,
                    imagem: "https://via.placeholder.com/150",
                    estoque: 100,
                    tag: "Mais Vendido"
                },
                {
                    id: 2,
                    nome: "Brainrot Avançado",
                    preco: 29.99,
                    preco_original: 49.99,
                    imagem: "https://via.placeholder.com/150", 
                    estoque: 50,
                    tag: "Popular"
                }
            ];
            res.json(defaultProducts);
        }
    } catch (error) {
        console.error('❌ Erro ao carregar produtos:', error);
        res.status(500).json({ error: 'Erro ao carregar produtos' });
    }
});

// Salvar produtos
app.post('/produtos', (req, res) => {
    try {
        const produtos = req.body;
        const produtosPath = path.join(__dirname, 'data/produtos.json');
        fs.writeFileSync(produtosPath, JSON.stringify(produtos, null, 2));
        res.json({ message: 'Produtos salvos com sucesso!' });
    } catch (error) {
        console.error('❌ Erro ao salvar produtos:', error);
        res.status(500).json({ error: 'Erro ao salvar produtos' });
    }
});

// Upload de arquivos para chat
app.post('/api/upload', upload.single('file'), (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ error: 'Nenhum arquivo enviado' });
        }

        const fileUrl = `/uploads/${req.file.filename}`;
        res.json({ 
            success: true, 
            fileUrl: fileUrl,
            fileName: req.file.originalname,
            fileType: req.file.mimetype
        });
    } catch (error) {
        console.error('❌ Erro no upload:', error);
        res.status(500).json({ error: 'Erro no upload do arquivo' });
    }
});

// Servir arquivos uploadados
app.use('/uploads', express.static('uploads'));

// API para gerenciar chats
app.get('/api/chats', (req, res) => {
    try {
        // Retornar todos os chats ativos
        res.json(activeChats);
    } catch (error) {
        console.error('❌ Erro ao carregar chats:', error);
        res.status(500).json({ error: 'Erro ao carregar chats' });
    }
});

app.post('/api/chats', (req, res) => {
    try {
        const { customer, items, total } = req.body;
        
        const chatId = 'chat_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
        
        const newChat = {
            id: chatId,
            customer: customer,
            items: items,
            total: total,
            status: 'active',
            paymentStatus: 'pending',
            messages: [
                {
                    id: 1,
                    text: `Olá! Acabei de fazer um pedido no valor de R$ ${total.toFixed(2)}. Nick no Roblox: ${customer.nick}`,
                    sender: 'client',
                    timestamp: new Date().toISOString(),
                    type: 'system'
                }
            ],
            lastMessage: `Novo pedido de ${customer.name} - R$ ${total.toFixed(2)}`,
            lastMessageTime: new Date().toISOString(),
            createdAt: new Date().toISOString()
        };

        activeChats.push(newChat);
        
        res.json({
            success: true,
            chatId: chatId,
            chat: newChat
        });
    } catch (error) {
        console.error('❌ Erro ao criar chat:', error);
        res.status(500).json({ error: 'Erro ao criar chat' });
    }
});

app.get('/api/chats/:chatId', (req, res) => {
    try {
        const chatId = req.params.chatId;
        const chat = activeChats.find(c => c.id === chatId);
        
        if (!chat) {
            return res.status(404).json({ error: 'Chat não encontrado' });
        }
        
        res.json(chat);
    } catch (error) {
        console.error('❌ Erro ao carregar chat:', error);
        res.status(500).json({ error: 'Erro ao carregar chat' });
    }
});

app.post('/api/chats/:chatId/messages', (req, res) => {
    try {
        const chatId = req.params.chatId;
        const { text, sender, type } = req.body;
        
        const chat = activeChats.find(c => c.id === chatId);
        if (!chat) {
            return res.status(404).json({ error: 'Chat não encontrado' });
        }

        const newMessage = {
            id: Date.now(),
            text: text,
            sender: sender || 'client',
            timestamp: new Date().toISOString(),
            type: type || 'text'
        };

        chat.messages.push(newMessage);
        chat.lastMessage = text;
        chat.lastMessageTime = newMessage.timestamp;

        // Broadcast via WebSocket
        broadcastToChat(chatId, {
            type: 'new_message',
            message: newMessage,
            sender: newMessage.sender
        });

        res.json(newMessage);
    } catch (error) {
        console.error('❌ Erro ao adicionar mensagem:', error);
        res.status(500).json({ error: 'Erro ao adicionar mensagem' });
    }
});

// Rota de health check
app.get('/health', (req, res) => {
    res.json({ 
        status: 'OK', 
        timestamp: new Date().toISOString(),
        service: 'BrainrotBR API',
        activeChats: activeChats.length
    });
});

// Inicialização do servidor
server.listen(PORT, () => {
    console.log(`🚀 Servidor rodando na porta ${PORT}`);
    console.log(`📱 Acesse: http://localhost:${PORT}`);
    console.log(`💬 WebSocket ativo para chats em tempo real`);
    
    // Criar diretório de uploads se não existir
    const uploadDir = './uploads';
    if (!fs.existsSync(uploadDir)) {
        fs.mkdirSync(uploadDir, { recursive: true });
        console.log(`📁 Diretório de uploads criado: ${uploadDir}`);
    }
});