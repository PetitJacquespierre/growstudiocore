// Estado de la App
let products = [];
let cart = [];
let bcvRate = 764.35; 
let WHATSAPP_NUMBER = typeof clientConfig !== 'undefined' && clientConfig.whatsapp ? clientConfig.whatsapp : "580000000000"; 
const MENU_API_URL = typeof clientConfig !== 'undefined' ? clientConfig.hojaDeCalculo : "";
const CLIENT_ID = typeof clientConfig !== 'undefined' ? clientConfig.id : "SIN_ID"; 

// === PANEL CENTRAL GROW STUDIO ===
const GROW_STUDIO_API_URL = "https://script.google.com/macros/s/AKfycbxQyj-9VTVcBoK_vDRZi1jwzXi-WABzZ1hVuxp0WAE_Gj7TVknm6NOwiEQOHQ2XS-qA/exec";

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

    // Mecanismo de Seguridad: Si tarda mucho, forzamos quitar el splash a los 5 segundos
    const failsafe = setTimeout(() => {
        dismissSplash();
    }, 5000);

    try {
        // Ejecutamos las llamadas al servidor de Google de forma PARALELA para ahorrar muchísimo tiempo
        const [isSuspended] = await Promise.all([
            checkSaaSStatus(),
            fetchMenuData(),
            fetchBCVRate()
        ]);
        
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
    // Si aÃºn no has puesto tu URL maestra, salta este paso para evitar errores
    if (!GROW_STUDIO_API_URL || GROW_STUDIO_API_URL.includes("URL_DE_")) {
        return false; 
    }
    
    try {
        const response = await fetch(GROW_STUDIO_API_URL);
        const data = await response.json();
        
        if (data && data.clientes) {
            const miCliente = data.clientes.find(c => c.id === CLIENT_ID);
            // Verifica si en el master el estado dice SUSPENDIDO
            if (miCliente && miCliente.estado.toUpperCase() === "SUSPENDIDO") {
                return true;
            }
        }
        return false;
    } catch (e) {
        console.error("No se pudo conectar con el Panel Central de Grow Studio:", e);
        return false; // Por seguridad, si falla tu Excel maestro, no le apaga la web al cliente
    }
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
        const response = await fetch(MENU_API_URL);
        const data = await response.json();
        
        // Compatibilidad con tu API anterior (array) o la nueva (objeto)
        if (Array.isArray(data)) {
            products = data;
        } else if (data && !data.error) {
            products = data.menu || [];
            
            // Compatibilidad con la variable vieja o la nueva
            if (data.estadoTienda) {
                storeStatus = data.estadoTienda;
            } else if (data.tiendaAbierta === false) {
                storeStatus = "CERRADO";
            }
            
            if (data.promos && data.promos.length > 0) renderPromos(data.promos);
        }
        checkBusinessHours();
    } catch (err) {
        console.error("Fallo al cargar el menÃº desde Sheets:", err);
    }
}

// =========================================
// LÃ“GICA DE HORARIOS
// =========================================
function checkBusinessHours() {
    // Si fuerzas la suspensiÃ³n por falta de pago (SaaS Kill Switch)
    if (storeStatus === "SUSPENDIDO") {
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
    const container = document.getElementById('promo-carousel');
    const track = document.getElementById('carousel-track');
    if (!container || !track) return;
    
    container.style.display = 'block';
    track.innerHTML = '';
    
    promos.forEach(promo => {
        const img = document.createElement('img');
        img.src = `img/${promo.imagen}`;
        img.onerror = () => { img.style.display = 'none'; };
        track.appendChild(img);
    });

    if (promos.length > 1) {
        setInterval(() => {
            currentPromoIndex = (currentPromoIndex + 1) % promos.length;
            track.style.transform = `translateX(-${currentPromoIndex * 100}%)`;
        }, 4000);
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
            bcvRate = parseFloat(data.usd);
            console.log("Â¡Divisas BCV en vivo sincronizadas! $: " + bcvRate);
        }
    } catch (error) {
        console.error("Error al conectar con la API central del BCV, usando tasa de respaldo (" + bcvRate + ").", error);
    } finally {
        const bcvElem = document.getElementById('bcv-value');
        if (bcvElem) {
            bcvElem.innerText = bcvRate.toFixed(2);
        }
    }
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
        btn.style.color = "#4ade80"; // Color verde Ã©xito
        
        setTimeout(() => {
            btn.innerHTML = originalIcon;
            btn.classList.remove('copied');
            btn.style.color = "";
        }, 2000);
    }).catch(err => {
        console.error('Error al copiar: ', err);
    });
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
    
    const name = nameInput ? nameInput.value.trim() : '';
    const address = addressInput ? addressInput.value.trim() : '';
    const notes = notesInput ? notesInput.value.trim() : '';
    
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
    
    if (!address && !isRetiro) {
        if(addressInput) addressInput.classList.add('input-error');
        isValid = false;
    } else {
        if(addressInput) addressInput.classList.remove('input-error');
    }

    if (!isValid) {
        // Removemos las clases despuÃ©s de que termine la animaciÃ³n (0.4s) para que pueda volver a vibrar si se equivoca de nuevo
        setTimeout(() => {
            if(nameInput) nameInput.classList.remove('input-error');
            if(addressInput) addressInput.classList.remove('input-error');
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
    
    // Usamos \r\n (Carriage Return + Line Feed) para que WhatsApp mÃ³vil respete estrictamente el salto de lÃ­nea
    let text = `==========================\r\n`;
    text += `*NUEVO PEDIDO - THE FOOD POINT*\r\n`;
    text += `==========================\r\n\r\n`;
    
    text += `*DATOS DEL CLIENTE*\r\n`;
    text += `- Cliente: ${name}\r\n`;
    text += `- DirecciÃ³n: ${address}\r\n`;
    text += `- Zona: ${deliveryName}\r\n`;
    text += `- Pago: ${paymentMethod}\r\n`;
    
    if (notes !== '') {
        text += `- Notas: ${notes}\r\n`;
    }
    
    text += `\r\n`;
    
    text += `*PRODUCTOS*\r\n`;

    cart.forEach(item => {
        const itemTotal = item.precio * item.qty;
        subtotal += itemTotal;
        text += `â€¢ ${item.qty}x ${item.nombre} ($${itemTotal.toFixed(2)})\r\n`;
    });

    const totalUsd = subtotal + deliveryCost;
    const totalBs = (totalUsd * bcvRate).toFixed(2);

    text += `\r\n*RESUMEN DE PAGO*\r\n`;
    text += `- Subtotal: $${subtotal.toFixed(2)}\r\n`;
    text += `- Delivery: $${deliveryCost.toFixed(2)}\r\n`;
    text += `*TOTAL A PAGAR: $${totalUsd.toFixed(2)} (${totalBs} Bs)*\r\n\r\n`;
    
    // Enlace dinÃ¡mico para promocionar la web (se adapta a tu dominio actual)
    const siteUrl = window.location.origin;
    text += `ðŸ” _Â¿Antojo? Pide tÃº tambiÃ©n rÃ¡pido y fÃ¡cil aquÃ­:_ \r\n`;
    text += `ðŸ‘‰ ${siteUrl}`;

    // Codificamos la URL. encodeURIComponent convierte \r\n en %0D%0A (El salto de lÃ­nea oficial para WhatsApp Mobile)
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
