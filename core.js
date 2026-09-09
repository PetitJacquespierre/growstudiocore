// Estado de la App
let products = [];
let cart = [];
let bcvRate = parseFloat(localStorage.getItem("bcvRateCache")) || 764.35; 
let WHATSAPP_NUMBER = typeof clientConfig !== 'undefined' && clientConfig.whatsapp ? clientConfig.whatsapp : "580000000000"; 
const MENU_API_URL = typeof clientConfig !== 'undefined' ? clientConfig.hojaDeCalculo : "";
const CLIENT_ID = typeof clientConfig !== 'undefined' ? clientConfig.id : "SIN_ID"; 

// URL MAESTRA DEL PANEL CENTRAL (Para el Kill Switch Global)
const GROW_STUDIO_API_URL = "URL_DE_TU_GOOGLE_SHEET_MAESTRO_AQUI";

// Bloquea que el navegador recuerde la posiciÃ³n del scroll al recargar
if ('scrollRestoration' in history) {
    history.scrollRestoration = 'manual';
}

// InicializaciÃ³n
document.addEventListener("DOMContentLoaded", async () => {
    // Forzamos ir al tope y ocultamos el scroll mientras carga
    window.scrollTo(0, 0);
    document.body.style.overflow = 'hidden';

    const bcvElem = document.getElementById('bcv-value');
    if (bcvElem) bcvElem.innerText = bcvRate.toFixed(2);

    // Failsafe de seguridad: Si despuÃ©s de 3 segundos alguna peticiÃ³n falla o es muy lenta, quita el splash para no dejar al cliente atrapado
    const failsafe = setTimeout(() => {
        dismissSplash();
    }, 3000);

    try {
        // Ejecutamos las llamadas al servidor de Google de forma PARALELA para ahorrar muchísimo tiempo
        const [isSuspended] = await Promise.all([
            checkSaaSStatus(),
            fetchMenuData()
        ]);
        
        // ACTUALIZACION EN LA SOMBRA (SWR): Busca la tasa real sin bloquear la carga
        fetchBCVRate().then((cambio) => {
            if (cambio) {
                renderMenu();
                renderUpsells();
                updateCart();
            }
        });
        
        if (isSuspended) {
            // Si está suspendido por Grow Studio, activamos el Kill Switch y NO renderizamos el menú
            clearTimeout(failsafe);
            suspendStoreUI();
            dismissSplash();
            return; 
        }
        
        // Si no está suspendido, pintamos todo
        renderFilters();
        renderMenu();
        renderUpsells();
        
    } catch (e) {
        console.error("Error crítico en la carga inicial:", e);
    } finally {
        clearTimeout(failsafe);
        // Pequeño respiro visual para que el navegador pinte el DOM
        setTimeout(() => {
            dismissSplash();
            initPromoSlider();
        }, 100);
        
        // Registrar PWA Service Worker
        if ('serviceWorker' in navigator) {
            navigator.serviceWorker.register('./sw.js')
                .then(() => console.log('PWA Service Worker Registrado'))
                .catch(err => console.error('PWA FallÃ³:', err));
        }
    }
});

// === LÃ“GICA DEL CARRUSEL DE PROMOCIONES ===
function initPromoSlider() {
    const slider = document.getElementById('promoSlider');
    const indicators = document.querySelectorAll('.slider-indicators .indicator');
    if (!slider || indicators.length === 0) return;

    let currentIndex = 0;
    const slideCount = indicators.length;

    // Actualiza los puntitos visuales segÃºn dÃ³nde estÃ© el scroll
    slider.addEventListener('scroll', () => {
        const scrollLeft = slider.scrollLeft;
        const slideWidth = slider.clientWidth;
        currentIndex = Math.round(scrollLeft / slideWidth);
        
        indicators.forEach((ind, i) => {
            ind.classList.toggle('active', i === currentIndex);
        });
    });

    // Auto rotaciÃ³n cada 4 segundos
    setInterval(() => {
        currentIndex = (currentIndex + 1) % slideCount;
        slider.scrollTo({
            left: currentIndex * slider.clientWidth,
            behavior: 'smooth'
        });
    }, 4000);
}

async function checkSaaSStatus() {
    // Ya no es necesario, el estado se chequea directo en Firebase al traer los productos
    return false;
}

function dismissSplash() {
    const splash = document.getElementById('splash-screen');
    if (splash) {
        splash.classList.add('hide-splash');
        document.body.style.overflow = '';
    }
}

// =========================================
// FETCH: DATOS DEL MENÃš Y CONFIGURACIONES
// =========================================
let storeStatus = "AUTO";

async function fetchMenuData() {
    try {
        // Inicializar Firebase dinámicamente para no romper el HTML viejo
        const { initializeApp } = await import("https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js");
        const { getFirestore, doc, getDoc, updateDoc, increment } = await import("https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js");
        
        const app = initializeApp({ projectId: "grow-studio-menus" });
        const db = getFirestore(app);
        
        // Cargar los datos del cliente desde la nueva Base de Datos ultrarrápida
        const docRef = doc(db, "clientes", CLIENT_ID);
        const docSnap = await getDoc(docRef);
        
        if (docSnap.exists()) {
            const data = docSnap.data();
            
            // Registrar visita
            updateDoc(docRef, { visitas: increment(1) }).catch(e=>console.log(e));
            
            // Filtrar solo los productos activos
            const todosLosProductos = data.productos || [];
            products = todosLosProductos.filter(p => !p.activo || p.activo.toUpperCase() === "SI");
            
            // Estado SaaS (Suspendido por falta de pago)
            storeStatus = data.estado || "ACTIVO";
            
            // Estado Horario Tienda (ABIERTO, CERRADO, AUTO)
            if (storeStatus !== "SUSPENDIDO" && storeStatus !== "MOROSO") {
                if (data.tiendaAbierta && data.tiendaAbierta.toUpperCase() !== "AUTO") {
                    storeStatus = data.tiendaAbierta.toUpperCase(); // Sobrescribe el estado horario solo si no está suspendido
                }
            }
            
            // Reemplazar WhatsApp si está en Firebase
            if (data.whatsapp && data.whatsapp.trim() !== "") {
                WHATSAPP_NUMBER = data.whatsapp.trim();
            }
            
            // Reemplazar Instagram si está en Firebase
            const igCard = document.querySelector('.instagram-card');
            if (igCard) {
                if (data.instagram && data.instagram.trim() !== "") {
                    let igValue = data.instagram.trim();
                    let igUrl = igValue;
                    let igHandle = igValue;

                    // Formatear URL vs Handle
                    if (igValue.startsWith('http')) {
                        // Si pegaron el link completo
                        const urlObj = new URL(igValue);
                        // Limpiar el pathname para obtener el usuario (ej: instagram.com/usuario/)
                        let pathSegments = urlObj.pathname.split('/').filter(s => s !== "");
                        igHandle = pathSegments.length > 0 ? "@" + pathSegments[0] : "@instagram";
                    } else {
                        // Si pusieron @usuario o usuario
                        igHandle = igValue.startsWith('@') ? igValue : "@" + igValue;
                        igUrl = `https://instagram.com/${igHandle.substring(1)}`;
                    }

                    igCard.href = igUrl;
                    const handleElem = igCard.querySelector('.ig-handle');
                    if (handleElem) handleElem.innerText = igHandle;
                    igCard.style.display = 'flex';
                } else {
                    igCard.style.display = 'none';
                }
            }

            // Filtrar y renderizar Promos (Banners) activos
            if (data.promos) {
                const promosActivas = data.promos.filter(p => p.activo && p.activo.toUpperCase() === "SI");
                renderPromos(promosActivas);
            }
            if (data.headerMedia) renderHeroBanner(data.headerMedia);
        } else {
            console.error("Cliente no encontrado en Firebase");
        }
        
        checkBusinessHours();
    } catch (err) {
        console.error("Fallo al cargar el menÃº desde Firebase:", err);
    }
}

// =========================================
// LÃ“GICA DE HORARIOS
// =========================================
function checkBusinessHours() {
    // Si fuerzas la suspensiÃ³n por falta de pago (SaaS Kill Switch)
    if (storeStatus === "SUSPENDIDO" || storeStatus === "MOROSO") {
        suspendStoreUI();
        return;
    }

    // Asegurarse de que si NO estÃ¡ suspendido, se oculte la pantalla por si acaso
    const suspendedScreen = document.getElementById('system-suspended-screen');
    if (suspendedScreen) suspendedScreen.style.display = 'none';

    // Si fuerzas el cierre desde el Excel
    if (storeStatus === "CERRADO") {
        closeStoreUI();
        return;
    }
    
    // Si fuerzas la apertura desde el Excel (sin importar la hora)
    if (storeStatus === "ABIERTO") {
        openStoreUI();
        return;
    }

    // MODO AUTO: SegÃºn Hora de Venezuela
    const now = new Date();
    const vzlaTime = new Date(now.toLocaleString("en-US", {timeZone: "America/Caracas"}));
    const hours = vzlaTime.getHours();

    // Abierto de 6 AM a 10 PM
    if (hours >= 6 && hours < 22) {
        openStoreUI();
    } else {
        closeStoreUI();
    }
}

function closeStoreUI() {
    const banner = document.getElementById('store-closed-banner');
    if (banner) banner.style.display = 'flex';
    
    // Deshabilitar botÃ³n de carrito
    const fab = document.getElementById('cart-fab');
    if (fab) {
        fab.style.opacity = '0.5';
        fab.style.pointerEvents = 'none';
        fab.onclick = (e) => {
            e.preventDefault();
            alert("Actualmente estamos cerrados. Abrimos a las 6:00 AM.");
        };
    }
}

function openStoreUI() {
    const banner = document.getElementById('store-closed-banner');
    if (banner) banner.style.display = 'none';
    
    const fab = document.getElementById('cart-fab');
    if (fab) {
        fab.style.opacity = '1';
        fab.style.pointerEvents = 'auto';
        fab.onclick = toggleCart; // Restaura funciÃ³n original
    }
}

function suspendStoreUI() {
    // Muestra la pantalla negra de mantenimiento
    const suspendedScreen = document.getElementById('system-suspended-screen');
    if (suspendedScreen) suspendedScreen.style.display = 'flex';
    
    // Oculta el carrito
    const fab = document.getElementById('cart-fab');
    if (fab) fab.style.display = 'none';

    // Deshabilita scroll
    document.body.style.overflow = 'hidden';
}

// =========================================
// CARRUSEL DE PROMOS
// =========================================
let currentPromoIndex = 0;
function renderPromos(promos) {
    const sliderParent = document.querySelector('.promo-slider-container');
    const container = document.getElementById('promoSlider');
    
    // Si no existen los elementos en el HTML (ej. clientes viejos), no hacemos nada
    if (!sliderParent && !container) return;
    
    // Si la estructura vieja era con track
    const oldContainer = document.getElementById('promo-carousel');
    const track = document.getElementById('carousel-track');
    
    if (promos.length === 0) {
        if (sliderParent) sliderParent.style.display = 'none';
        if (oldContainer) oldContainer.style.display = 'none';
        return;
    }
    
    // Para la estructura NUEVA (como Demo_Menu_Digital)
    if (container && sliderParent) {
        sliderParent.style.display = 'block';
        container.innerHTML = '';
        
        promos.forEach(promo => {
            const div = document.createElement('div');
            div.className = 'promo-slide';
            let imgSrc = promo.imagen.startsWith('http') ? promo.imagen : `img/${promo.imagen}`;
            div.innerHTML = `<img src="${imgSrc}" alt="Promo">`;
            
            // Intento 1: usar producto_id explícito de Firebase
            let targetId = promo.producto_id || promo.productoId;
            
            // Intento 2 (Truco Mágico): Inferir el ID del producto basado en el nombre de la imagen
            if (!targetId) {
                const imageName = promo.imagen.split('/').pop().split('.')[0]; 
                const matchedProduct = products.find(p => String(p.id).toLowerCase() === imageName.toLowerCase());
                if (matchedProduct) {
                    targetId = matchedProduct.id;
                }
            }
            
            // Intento 3 (Producto Virtual): Si llenaron Nombre y Precio directamente en la tabla de Promos
            if (!targetId && promo.nombre && parseFloat(promo.precio) > 0) {
                targetId = {
                    id: 'promo_' + promo.imagen, // ID único basado en la imagen para poder sumar cantidades
                    nombre: promo.nombre,
                    descripcion: promo.descripcion || '',
                    precio: parseFloat(promo.precio),
                    imagen: promo.imagen,
                    categoria: 'Promociones'
                };
            }
            
            if (targetId) {
                div.style.cursor = 'pointer';
                div.style.position = 'relative';
                
                const badge = document.createElement('div');
                badge.innerHTML = '<i class="fa-solid fa-hand-pointer fa-beat"></i> ¡TOCA PARA PEDIR!';
                badge.style.position = 'absolute';
                badge.style.bottom = '15px';
                badge.style.right = '15px';
                badge.style.backgroundColor = '#fbbf24';
                badge.style.color = '#000';
                badge.style.padding = '8px 16px';
                badge.style.borderRadius = '25px';
                badge.style.fontWeight = '800';
                badge.style.fontSize = '12px';
                badge.style.letterSpacing = '0.5px';
                badge.style.boxShadow = '0 5px 15px rgba(0,0,0,0.6)';
                badge.style.zIndex = '10';
                badge.style.pointerEvents = 'none'; // Evita bloquear el click principal
                
                div.appendChild(badge);

                div.onclick = () => {
                    addToCart(targetId);
                    const fab = document.getElementById('cart-fab');
                    if(fab) fab.click(); // Abre el carrito
                };
            } else {
                div.style.cursor = 'pointer';
                div.onclick = () => {
                    const grid = document.getElementById('menu-grid');
                    if(grid) grid.scrollIntoView({behavior: 'smooth'});
                };
            }

            container.appendChild(div);
        });
    } 
    // Para la estructura VIEJA (si existe en otros HTML)
    else if (oldContainer && track) {
        oldContainer.style.display = 'block';
        track.innerHTML = '';
        
        promos.forEach(promo => {
            const img = document.createElement('img');
            img.src = promo.imagen.startsWith('http') ? promo.imagen : `img/${promo.imagen}`;
            img.onerror = () => { img.style.display = 'none'; };
            
            let targetId = promo.producto_id || promo.productoId;
            if (!targetId) {
                const imageName = promo.imagen.split('/').pop().split('.')[0]; 
                const matchedProduct = products.find(p => String(p.id).toLowerCase() === imageName.toLowerCase());
                if (matchedProduct) {
                    targetId = matchedProduct.id;
                }
            }
            
            // Intento 3 (Producto Virtual): Si llenaron Nombre y Precio directamente en la tabla de Promos
            if (!targetId && promo.nombre && parseFloat(promo.precio) > 0) {
                targetId = {
                    id: 'promo_' + promo.imagen,
                    nombre: promo.nombre,
                    descripcion: promo.descripcion || '',
                    precio: parseFloat(promo.precio),
                    imagen: promo.imagen,
                    categoria: 'Promociones'
                };
            }
            
            if (targetId) {
                img.style.cursor = 'pointer';
                img.onclick = () => {
                    addToCart(targetId);
                    const fab = document.getElementById('cart-fab');
                    if(fab) fab.click();
                };
            } else {
                img.style.cursor = 'pointer';
                img.onclick = () => {
                    const grid = document.getElementById('menu-grid');
                    if(grid) grid.scrollIntoView({behavior: 'smooth'});
                };
            }

            track.appendChild(img);
        });

        if (promos.length > 1) {
            setInterval(() => {
                currentPromoIndex = (currentPromoIndex + 1) % promos.length;
                track.style.transform = `translateX(-${currentPromoIndex * 100}%)`;
            }, 4000);
        }
    }
}

// =========================================
// FETCH: TASA BCV EN VIVO (Scraping API BCV)
// =========================================
const URL_API_DIVISAS_BCV = "https://script.google.com/macros/s/AKfycbwsoD8ahtAQUqfY0TQWf3-dDs29HL8kEJa2t-mjDR3PAo3exTTmtSwXqYuNB2ob5dFpgw/exec";

async function fetchBCVRate() {
    try {
        const response = await fetch(URL_API_DIVISAS_BCV);
        const data = await response.json();
        
        if (data && data.usd) {
            const nuevaTasa = parseFloat(data.usd);
            
            // Protección contra la tasa de respaldo de Google Apps Script o Binance fallido (0.00)
            if (nuevaTasa > 10 && nuevaTasa !== bcvRate) {
                bcvRate = nuevaTasa;
                localStorage.setItem("bcvRateCache", bcvRate);
                console.log("¡BCV actualizado en pantalla en 2do plano! $: " + bcvRate);
                const bcvElem = document.getElementById('bcv-value');
                if (bcvElem) bcvElem.innerText = bcvRate.toFixed(2);
                return true; 
            }
        }
    } catch (error) {
        console.error("Error al conectar API BCV, manteniendo tasa cacheada: " + bcvRate, error);
    }
    return false;
}

// =========================================
// RENDERIZADO: FILTROS DINÃMICOS
// =========================================
let currentCategory = 'Todos';

function renderFilters() {
    const filtersContainer = document.getElementById('menu-filters');
    if (!filtersContainer) return;

    // Extraer categorÃ­as Ãºnicas usando un Set
    const categorias = [...new Set(products.map(p => p.categoria))].filter(Boolean);
    
    // Si la base de datos estÃ¡ vacÃ­a o fallÃ³, no mostramos filtros
    if (categorias.length === 0) return;

    // Colocamos "Todos" como primera opciÃ³n
    categorias.unshift('Todos');

    filtersContainer.innerHTML = '';
    
    categorias.forEach(cat => {
        const btn = document.createElement('button');
        btn.className = `filter-btn ${cat === currentCategory ? 'active' : ''}`;
        btn.innerText = cat;
        btn.onclick = () => {
            // Efecto visual: apagar todos y encender el presionado
            document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            
            // Actualizar estado y re-dibujar el menÃº
            currentCategory = cat;
            renderMenu();
        };
        filtersContainer.appendChild(btn);
    });
}

// =========================================
// RENDERIZADO: PRODUCTOS
// =========================================
function renderMenu() {
    const grid = document.getElementById('menu-grid');
    if (!grid) return;
    grid.innerHTML = '';

    // Filtrado lÃ³gico
    const filteredProducts = currentCategory === 'Todos' 
        ? products 
        : products.filter(p => p.categoria === currentCategory);

    if (filteredProducts.length === 0) {
        grid.innerHTML = '<p style="text-align:center; color:#ccc; width:100%; grid-column: 1 / -1; padding: 40px 0;">No hay productos en esta categorÃ­a.</p>';
        return;
    }

    // Dibujado de tarjetas
    filteredProducts.forEach(p => {
        const bsPrice = (p.precio * bcvRate).toFixed(2);
        
        // LÃ³gica Inteligente para ImÃ¡genes: Soporta tanto links de internet como archivos locales
        let imgSrc = '';
        if (p.imagen) {
            if (p.imagen.startsWith('http://') || p.imagen.startsWith('https://')) {
                imgSrc = p.imagen; // Link web directo
            } else {
                imgSrc = `img/${p.imagen}`; // Archivo local en tu carpeta img/
            }
        }

        const imgHtml = imgSrc 
            ? `<img src="${imgSrc}" alt="${p.nombre}" onerror="this.onerror=null; this.parentElement.innerHTML='<i class=\\'fa-solid fa-image\\'></i>';">` 
            : `<i class="fa-solid fa-image"></i>`;

        const html = `
            <div class="product-card" onclick="addToCart(${p.id})">
                <div class="product-image-box">
                    ${imgHtml}
                </div>
                <div class="product-content">
                    <div class="product-info">
                        <h3>${p.nombre}</h3>
                        <p class="product-desc">${p.descripcion}</p>
                    </div>
                    <div class="product-price">
                        <div class="price-usd">$${p.precio.toFixed(2)}</div>
                        <div class="price-bs">Aprox. ${bsPrice} Bs</div>
                    </div>
                    <button class="add-btn">
                        <i class="fa-solid fa-plus"></i> AGREGAR
                    </button>
                </div>
            </div>
        `;
        grid.innerHTML += html;
    });
}

function renderUpsells() {
    const upsellContainer = document.querySelector('.upsell-container');
    if (!upsellContainer) return;
    
    let html = '';
    
    const extras = [
        { id: 'extra_huevo', nombre: 'Huevo', precio: 0.50 },
        { id: 'extra_maiz', nombre: 'Maíz', precio: 0.50 },
        { id: 'extra_tocineta', nombre: 'Tocineta', precio: 1.00 },
        { id: 'extra_quesokraft', nombre: 'Queso Kraft', precio: 1.00 },
        { id: 'extra_pepinillo', nombre: 'Pepinillo', precio: 0.50 }
    ];

    extras.forEach(extra => {
        html += `<button class="upsell-btn" onclick="addToCart({id: '${extra.id}', nombre: 'Extra ${extra.nombre}', precio: ${extra.precio}})">
            + ${extra.nombre} ($${extra.precio.toFixed(2)})
        </button>`;
    });
    
    upsellContainer.innerHTML = html;
}

// =========================================
// LÃ“GICA DEL CARRITO
// =========================================
function addToCart(itemOrId) {
    let product;
    if (typeof itemOrId === 'object' && itemOrId !== null) {
        product = itemOrId; // Objeto directo de Upsell
    } else {
        // Es un ID (nÃºmero o string)
        product = products.find(p => String(p.id) === String(itemOrId));
    }
    
    if (!product) return;

    const existing = cart.find(item => item.id === product.id);

    if (existing) {
        existing.qty++;
    } else {
        cart.push({ ...product, qty: 1 });
    }
    
    updateCartUI();
    
    // Haptic Feedback (VibraciÃ³n en mÃ³viles)
    if (navigator.vibrate) {
        navigator.vibrate(50);
    }
    
    // Efecto de palpitaciÃ³n en el botÃ³n flotante al agregar
    const fab = document.getElementById('cart-fab');
    if (fab) {
        fab.classList.remove('animate-pop');
        void fab.offsetWidth; // Trigger reflow
        fab.classList.add('animate-pop');
    }
}

function updateQty(id, delta) {
    const item = cart.find(i => String(i.id) === String(id));
    if (item) {
        item.qty += delta;
        if (item.qty <= 0) {
            cart = cart.filter(i => String(i.id) !== String(id));
        }
    }
    updateCartUI();
}

function updateCartUI() {
    const cartItems = document.getElementById('cart-items');
    const fabCount = document.getElementById('cart-count');
    const fabTotalUsd = document.getElementById('fab-total-usd');
    const fabTotalBs = document.getElementById('fab-total-bs');
    
    let subtotal = 0;
    let totalItems = 0;
    
    if (cartItems) cartItems.innerHTML = '';

    if (cart.length === 0) {
        if (cartItems) cartItems.innerHTML = '<p class="empty-cart"><i class="fa-solid fa-basket-shopping fa-2x"></i><br><br>Tu carrito estÃ¡ vacÃ­o.</p>';
        if (fabCount) fabCount.innerText = "0";
        if (fabTotalUsd) fabTotalUsd.innerText = "$0.00";
        if (fabTotalBs) fabTotalBs.innerText = "0.00 Bs";
        updateTotal(0);
        return;
    }

    cart.forEach(item => {
        const itemTotal = item.precio * item.qty;
        subtotal += itemTotal;
        totalItems += item.qty;

        if (cartItems) {
            let imgSrc = '';
            if (item.imagen) {
                if (item.imagen.startsWith('http://') || item.imagen.startsWith('https://')) {
                    imgSrc = item.imagen;
                } else {
                    imgSrc = `img/${item.imagen}`;
                }
            }
            const imgHtml = imgSrc 
                ? `<img src="${imgSrc}" alt="${item.nombre}" style="width: 50px; height: 50px; object-fit: cover; border-radius: 8px;" onerror="this.style.display='none'">` 
                : `<div style="width: 50px; height: 50px; background: #222; border-radius: 8px; display: flex; align-items: center; justify-content: center; color: #555;"><i class="fa-solid fa-image"></i></div>`;

            cartItems.innerHTML += `
                <div class="cart-item" style="display: flex; align-items: center; gap: 15px; margin-bottom: 15px;">
                    ${imgHtml}
                    <div class="item-info" style="flex: 1;">
                        <h4 style="margin: 0; font-size: 0.95rem; color: #fff;">${item.nombre}</h4>
                        <p style="margin: 3px 0 0 0; color: #aaa; font-size: 0.85rem;">$${itemTotal.toFixed(2)} USD</p>
                    </div>
                    <div class="qty-controls">
                        <button class="qty-btn" onclick="updateQty('${item.id}', -1)">${item.qty === 1 ? '<i class="fa-solid fa-trash-can" style="font-size: 0.9rem;"></i>' : '-'}</button>
                        <span>${item.qty}</span>
                        <button class="qty-btn" onclick="updateQty('${item.id}', 1)">+</button>
                    </div>
                </div>
            `;
        }
    });

    const bsSubtotal = (subtotal * bcvRate).toFixed(2);
    if (fabCount) fabCount.innerText = totalItems;
    if (fabTotalUsd) fabTotalUsd.innerText = `$${subtotal.toFixed(2)}`;
    if (fabTotalBs) fabTotalBs.innerText = `${bsSubtotal} Bs`;
    
    updateTotal(subtotal);
}

function updateTotal(subtotalCalc = null) {
    let subtotal = subtotalCalc;
    if (subtotal === null) {
        subtotal = cart.reduce((sum, item) => sum + (item.precio * item.qty), 0);
    }
    
    const deliverySelect = document.getElementById('delivery-zone');
    const deliveryCost = deliverySelect ? parseFloat(deliverySelect.value) : 0;
    
    const totalUsd = subtotal + deliveryCost;
    const totalBs = (totalUsd * bcvRate).toFixed(2);

    const elemSubtotal = document.getElementById('summary-subtotal');
    const elemDelivery = document.getElementById('summary-delivery');
    const elemTotalUsd = document.getElementById('summary-total-usd');
    const elemTotalBs = document.getElementById('summary-total-bs');

    if (elemSubtotal) elemSubtotal.innerText = `$${subtotal.toFixed(2)}`;
    if (elemDelivery) elemDelivery.innerText = deliveryCost === 0 ? "GRATIS" : `$${deliveryCost.toFixed(2)} USD`;
    if (elemTotalUsd) elemTotalUsd.innerText = `$${totalUsd.toFixed(2)} USD`;
    if (elemTotalBs) elemTotalBs.innerText = `${totalBs} Bs`;
    
    // Actualizar tambiÃ©n el monto exacto de Pago MÃ³vil si existe en el DOM
    const elemPmAmount = document.getElementById('pm-amount');
    if (elemPmAmount) elemPmAmount.innerText = `${totalBs} Bs`;
}

function toggleCart() {
    const modal = document.getElementById('cart-modal');
    const fab = document.getElementById('cart-fab');
    if (modal) {
        if (modal.classList.contains('active')) {
            modal.classList.remove('active');
            if (fab) fab.style.setProperty('display', 'flex', 'important');
        } else {
            modal.classList.add('active');
            if (fab) fab.style.setProperty('display', 'none', 'important');
        }
    }
}

// =========================================
// MÃ‰TODOS DE PAGO Y PORTAPAPELES
// =========================================
function togglePaymentDetails() {
    const method = document.getElementById('payment-method').value;
    const pmDetails = document.getElementById('pago-movil-details');
    if (pmDetails) {
        if (method === "Pago MÃ³vil") {
            pmDetails.style.display = "block";
        } else {
            pmDetails.style.display = "none";
        }
    }
}

function copyToClipboard(elementId, btn) {
    const textToCopy = document.getElementById(elementId).innerText;
    navigator.clipboard.writeText(textToCopy).then(() => {
        const originalIcon = btn.innerHTML;
        btn.innerHTML = '<i class="fa-solid fa-check text-yellow"></i> Copiado';
        btn.classList.add('copied');
        btn.style.color = "#4ade80"; // Color verde éxito
        
        setTimeout(() => {
            btn.innerHTML = originalIcon;
            btn.classList.remove('copied');
            btn.style.color = "";
        }, 2000);
    }).catch(err => {
        console.error('Error al copiar: ', err);
    });
}

function copyAllPagoMovil(btn) {
    const phone = document.getElementById('pm-phone') ? document.getElementById('pm-phone').innerText : '';
    const id = document.getElementById('pm-id') ? document.getElementById('pm-id').innerText : '';
    const bank = document.getElementById('pm-bank') ? document.getElementById('pm-bank').innerText : '';
    const amount = document.getElementById('pm-amount') ? document.getElementById('pm-amount').innerText : '';
    
    const textToCopy = `Datos de Pago Móvil:\nBanco: ${bank}\nTeléfono: ${phone}\nCédula: ${id}\nMonto: ${amount}`;
    
    navigator.clipboard.writeText(textToCopy).then(() => {
        const originalHTML = btn.innerHTML;
        btn.innerHTML = '<i class="fa-solid fa-check text-yellow"></i> ¡TODOS LOS DATOS COPIADOS!';
        btn.style.color = "#4ade80";
        btn.style.borderColor = "#4ade80";
        
        setTimeout(() => {
            btn.innerHTML = originalHTML;
            btn.style.color = "";
            btn.style.borderColor = "";
        }, 3000);
    }).catch(err => console.error('Error al copiar todos los datos: ', err));
}

// =========================================
// WHATSAPP CHECKOUT
// =========================================
function sendOrder() {
    if (cart.length === 0) {
        alert("Â¡Tu carrito estÃ¡ vacÃ­o! Agrega algunas hamburguesas o perros calientes primero.");
        return;
    }

    const nameInput = document.getElementById('customer-name');
    const addressInput = document.getElementById('customer-address');
    const notesInput = document.getElementById('customer-notes');
    const referralInput = document.getElementById('referral-code');
    
    const name = nameInput ? nameInput.value.trim() : '';
    const address = addressInput ? addressInput.value.trim() : '';
    const notes = notesInput ? notesInput.value.trim() : '';
    const referralCode = referralInput ? referralInput.value.trim() : '';
    
    const deliverySelect = document.getElementById('delivery-zone');
    const deliveryName = deliverySelect ? deliverySelect.options[deliverySelect.selectedIndex].text : 'Delivery';
    const isRetiro = deliverySelect ? deliverySelect.options[deliverySelect.selectedIndex].getAttribute('data-type') === 'retiro' : false;
    const deliveryCost = deliverySelect ? parseFloat(deliverySelect.value) : 0;

    const paymentSelect = document.getElementById('payment-method');
    const paymentMethod = paymentSelect ? paymentSelect.value : 'Pago MÃ³vil';

    // ValidaciÃ³n Visual Premium (Sin Alerts feos)
    let isValid = true;
    
    if (!name) {
        if(nameInput) nameInput.classList.add('input-error');
        isValid = false;
    } else {
        if(nameInput) nameInput.classList.remove('input-error');
    }
    
    // Dirección ya no es obligatoria según solicitud del cliente
    if(addressInput) addressInput.classList.remove('input-error');

    if (!isValid) {
        // Removemos las clases despuÃ©s de que termine la animaciÃ³n (0.4s)
        setTimeout(() => {
            if(nameInput) nameInput.classList.remove('input-error');
        }, 500);
        
        // Un botÃ³n vibratorio o un texto temporal en el botÃ³n
        const btn = document.querySelector('.whatsapp-btn');
        if(btn) {
            const originalText = btn.innerHTML;
            btn.innerHTML = '<i class="fa-solid fa-triangle-exclamation"></i> COMPLETA TUS DATOS';
            btn.style.backgroundColor = '#dc3545';
            setTimeout(() => {
                btn.innerHTML = originalText;
                btn.style.backgroundColor = '';
            }, 2000);
        }
        return;
    }

    let subtotal = 0;
    
    // Usamos \r\n (Carriage Return + Line Feed) para que WhatsApp móvil respete estrictamente el salto de línea
    let text = `==========================\r\n`;
    const bName = typeof clientConfig !== 'undefined' && clientConfig.businessName ? clientConfig.businessName.toUpperCase() : "NUEVO PEDIDO";
    text += `*${bName}*\r\n`;
    text += `==========================\r\n\r\n`;
    
    text += `*DATOS DEL CLIENTE*\r\n`;
    text += `- Cliente: ${name}\r\n`;
    if (address !== '') {
        text += `- Dirección: ${address}\r\n`;
    }
    text += `- Zona: ${deliveryName}\r\n`;
    text += `- Pago: ${paymentMethod}\r\n`;
    
    if (notes !== '') {
        text += `- Notas: ${notes}\r\n`;
    }
    
    if (referralCode !== '') {
        text += `- Código Referido: ${referralCode}\r\n`;
    }
    
    text += `\r\n`;
    
    text += `*PRODUCTOS*\r\n`;

    cart.forEach(item => {
        const itemTotal = item.precio * item.qty;
        subtotal += itemTotal;
        text += `• ${item.qty}x ${item.nombre} ($${itemTotal.toFixed(2)})\r\n`;
    });

    const totalUsd = subtotal + deliveryCost;
    const totalBs = (totalUsd * bcvRate).toFixed(2);

    text += `\r\n*RESUMEN DE PAGO*\r\n`;
    text += `- Subtotal: $${subtotal.toFixed(2)}\r\n`;
    text += `- Delivery: $${deliveryCost.toFixed(2)}\r\n`;
    text += `*TOTAL A PAGAR: $${totalUsd.toFixed(2)} (${totalBs} Bs)*\r\n\r\n`;
    
    // Enlace dinámico para promocionar la web (se adapta a tu dominio actual)
    const siteUrl = window.location.origin;
    text += `🍔 _¿Antojo? Pide tú también rápido y fácil aquí:_ \r\n`;
    text += `👉 ${siteUrl}`;

    // Codificamos la URL. encodeURIComponent convierte \r\n en %0D%0A (El salto de línea oficial para WhatsApp Mobile)
    const encodedText = encodeURIComponent(text);
    const whatsappUrl = `https://wa.me/${WHATSAPP_NUMBER}?text=${encodedText}`;
    
    window.open(whatsappUrl, '_blank');
}

// =========================================
// PWA INSTALLATION LOGIC
// =========================================
let deferredPrompt;

window.addEventListener('beforeinstallprompt', (e) => {
    // Evita que Chrome muestre el mini-infobar por defecto
    e.preventDefault();
    // Guarda el evento para dispararlo luego
    deferredPrompt = e;
    
    // Muestra el botÃ³n de instalaciÃ³n en la interfaz
    const installBtn = document.getElementById('btn-install-pwa');
    if (installBtn) {
        installBtn.style.display = 'block';
        installBtn.addEventListener('click', async () => {
            // Muestra el prompt de instalaciÃ³n nativo
            deferredPrompt.prompt();
            // Espera la respuesta del usuario
            const { outcome } = await deferredPrompt.userChoice;
            console.log(`Respuesta del usuario a la instalaciÃ³n: ${outcome}`);
            // Limpia la variable
            deferredPrompt = null;
            // Oculta el botÃ³n
            installBtn.style.display = 'none';
        });
    }
});

window.addEventListener('appinstalled', (evt) => {
    console.log('AplicaciÃ³n PWA instalada correctamente');
    const installBtn = document.getElementById('btn-install-pwa');
    if (installBtn) installBtn.style.display = 'none';
});



// =========================================
// DRAG TO SCROLL (Para PC)
// =========================================
function enableDragToScroll(selector) {
    document.querySelectorAll(selector).forEach(slider => {
        let isDown = false;
        let startX;
        let scrollLeft;
        slider.addEventListener('mousedown', (e) => {
            isDown = true;
            slider.classList.add('active');
            startX = e.pageX - slider.offsetLeft;
            scrollLeft = slider.scrollLeft;
        });
        slider.addEventListener('mouseleave', () => {
            isDown = false;
            slider.classList.remove('active');
        });
        slider.addEventListener('mouseup', () => {
            isDown = false;
            slider.classList.remove('active');
        });
        slider.addEventListener('mousemove', (e) => {
            if(!isDown) return;
            e.preventDefault();
            const x = e.pageX - slider.offsetLeft;
            const walk = (x - startX) * 2;
            slider.scrollLeft = scrollLeft - walk;
        });
    });
}

document.addEventListener('DOMContentLoaded', () => {
    setTimeout(() => {
        enableDragToScroll('.upsell-container');
        enableDragToScroll('.filters-container');
        enableDragToScroll('.promos-container');
    }, 1500);
});


// =========================================
// RENDERIZADO: HERO BANNER (PORTADA PREMIUM)
// =========================================
function renderHeroBanner(mediaUrl) {
    if (!mediaUrl) return;

    // Prevenir duplicados si se llama dos veces
    if (document.getElementById('dynamic-hero-banner')) return;

    const header = document.querySelector('header');
    const oldHero = document.querySelector('.hero');
    if (oldHero) oldHero.style.display = 'none';
    if (!header) return;

    const heroDiv = document.createElement('div');
    heroDiv.id = 'dynamic-hero-banner';
    heroDiv.style.position = 'relative';
    heroDiv.style.width = '100%';
    heroDiv.style.height = '45vh'; 
    heroDiv.style.minHeight = '300px';
    heroDiv.style.overflow = 'hidden';
    heroDiv.style.display = 'flex';
    heroDiv.style.alignItems = 'flex-end';
    heroDiv.style.justifyContent = 'center';
    heroDiv.style.paddingBottom = '20px'; // Bajar un poco (menos padding bottom)
    heroDiv.style.marginTop = '-80px'; // Para quedar debajo del header transparente

    const isVideo = mediaUrl.match(/\.(mp4|webm|ogg)$/i) || mediaUrl.includes('video');
    const headerLogoImg = document.getElementById('header-logo');
    const logoSrc = headerLogoImg ? headerLogoImg.src : 'img/logo.png';
    
    if (isVideo) {
        heroDiv.innerHTML = `
            <video autoplay loop muted playsinline style="position:absolute; top:0; left:0; width:100%; height:100%; object-fit:cover; z-index:1;">
                <source src="${mediaUrl}" type="video/mp4">
            </video>
        `;
    } else {
        heroDiv.innerHTML = `
            <div style="position:absolute; top:0; left:0; width:100%; height:100%; background-image:url('${mediaUrl}'); background-size:cover; background-position:center; z-index:1;"></div>
        `;
    }

    const overlay = document.createElement('div');
    overlay.style.position = 'absolute';
    overlay.style.top = '0';
    overlay.style.left = '0';
    overlay.style.width = '100%';
    overlay.style.height = '100%';
    overlay.style.background = 'linear-gradient(to bottom, rgba(0,0,0,0.1) 0%, var(--bg) 100%)';
    overlay.style.zIndex = '2';
    heroDiv.appendChild(overlay);

    if (isVideo) {
        // Logo en el medio, bajado un poco
        const centerLogo = document.createElement('img');
        centerLogo.src = logoSrc;
        centerLogo.style.position = 'relative';
        centerLogo.style.zIndex = '3';
        centerLogo.style.width = '120px';
        centerLogo.style.height = '120px';
        centerLogo.style.objectFit = 'contain';
        centerLogo.style.filter = 'drop-shadow(0 4px 10px rgba(0,0,0,0.5))';
        centerLogo.style.borderRadius = '20px';
        centerLogo.style.background = 'rgba(255,255,255,0.1)';
        centerLogo.style.backdropFilter = 'blur(10px)'; 
        centerLogo.style.padding = '10px';
        centerLogo.style.border = '1px solid rgba(255,255,255,0.2)';
        centerLogo.style.marginBottom = '-20px'; // Bajarlo un cuarto visualmente
        
        heroDiv.appendChild(centerLogo);
        if (headerLogoImg) headerLogoImg.style.display = 'none'; // Ocultar el del header
    } else {
        // Si es imagen, forzar que el logo aparezca arriba a la izquierda
        if (headerLogoImg) headerLogoImg.style.display = 'block';
    }

    header.style.backgroundColor = 'transparent';
    header.style.position = 'sticky';
    header.style.top = '0';
    header.style.zIndex = '100';
    header.style.boxShadow = 'none';
    header.style.transition = 'background-color 0.3s ease';

    // Hacer que el header gane fondo al scrollear para que no se mezcle con los productos
    window.addEventListener('scroll', () => {
        if (window.scrollY > 50) {
            header.style.backgroundColor = 'rgba(0, 0, 0, 0.95)';
            header.style.boxShadow = '0 4px 20px rgba(0,0,0,0.8)';
        } else {
            header.style.backgroundColor = 'transparent';
            header.style.boxShadow = 'none';
        }
    });

    header.parentNode.insertBefore(heroDiv, header.nextSibling);
}
