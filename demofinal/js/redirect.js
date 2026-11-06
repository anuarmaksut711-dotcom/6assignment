'use strict';
// Compatibility pages only redirect; they do not use jQuery or inline JavaScript.
const destination = location.pathname.endsWith('/cart.html')
  ? 'booking.html?mode=packages#packages' : 'rooms.html';
location.replace(destination);
