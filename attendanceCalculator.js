const collegeConfig = require('./collegeConfig.json');

function calculateClasses(startDate, endDate) {
  const subjectCounts = {
    CGIP: 0, CD: 0, IEFT: 0, AAD: 0, ELEC: 0
  };

  let currentDate = new Date(startDate);
  const stopDate = new Date(endDate);

  while (currentDate <= stopDate) {
    const dateString = currentDate.toISOString().split('T')[0];
    const dayOfWeek = currentDate.toLocaleDateString('en-US', { weekday: 'long' });

    // Skip weekends (Saturday = 6, Sunday = 0)
    const isWeekend = currentDate.getDay() === 0 || currentDate.getDay() === 6;
    
    // Skip holidays and exams
    const isHoliday = collegeConfig.holidays_and_exams.includes(dateString);

    if (!isWeekend && !isHoliday && collegeConfig.timetable[dayOfWeek]) {
      collegeConfig.timetable[dayOfWeek].forEach(subject => {
        if (subjectCounts[subject] !== undefined) {
          subjectCounts[subject]++;
        }
      });
    }

    currentDate.setDate(currentDate.getDate() + 1);
  }

  return subjectCounts;
}

// Export the function and config so other files can use them!
module.exports = {
  calculateClasses,
  collegeConfig
};