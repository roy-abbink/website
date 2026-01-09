// Fetch the current year and update the copyright text
document.addEventListener('DOMContentLoaded', function() {
    const currentYear = new Date().getFullYear();
    const yearElement = document.getElementById('currentYear');
    if (yearElement) {
        yearElement.textContent = currentYear;
    }

    // Update future date with day of week
    const futureDateElement = document.getElementById('futureDate');
    if (futureDateElement) {
        futureDateElement.textContent = formatFutureDateWithDayName();
    }
});

/**
 * Formats a future date with the Dutch day name
 * Format: "Weekdag d m Y" (e.g., "Maandag 15 3 2026")
 * @param {Date} date - The date to format (default: 30 days from now)
 * @returns {string} Formatted date string
 */
function formatFutureDateWithDayName(date = null) {
    // If no date provided, use 30 days from now as example
    const futureDate = date || new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

    // Array of Dutch day names
    const dayNames = ['Zondag', 'Maandag', 'Dinsdag', 'Woensdag', 'Donderdag', 'Vrijdag', 'Zaterdag'];

    // Get day of week (0-6)
    const dayOfWeek = futureDate.getDay();
    const dayName = dayNames[dayOfWeek];

    // Get day, month, year
    const day = futureDate.getDate();
    const month = futureDate.getMonth() + 1; // Months are 0-indexed
    const year = futureDate.getFullYear();

    // Return formatted string: "Weekdag d m Y"
    return `${dayName} ${day} ${month} ${year}`;
}