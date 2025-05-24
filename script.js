// Fetch the current year and update the copyright text
document.addEventListener('DOMContentLoaded', function() {
    const currentYear = new Date().getFullYear();
    document.getElementById('currentYear').textContent = currentYear;
});