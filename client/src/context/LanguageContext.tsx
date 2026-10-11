import React, { createContext, useContext, useState, useEffect } from 'react';

export type Language = 'en' | 'bn' | 'hi';

interface Translations {
  [key: string]: {
    en: string;
    bn: string;
    hi: string;
  };
}

export const translations: Translations = {
  // Navigation
  dashboard: { en: 'Dashboard', bn: 'ড্যাশবোর্ড', hi: 'डैशबोर्ड' },
  pos: { en: 'POS Billing', bn: 'পিওএস বিলিং', hi: 'पीओएस बिलिंग' },
  inventory: { en: 'Inventory', bn: 'ইনভেন্টরি (মজুত)', hi: 'इन्वेंटरी' },
  invoices: { en: 'Invoices & Sales', bn: 'ইনভয়েস ও বিক্রয়', hi: 'इनवॉइस और बिक्री' },
  customers: { en: 'Customers', bn: 'গ্রাহক তালিকা', hi: 'ग्राहक सूची' },
  purchases: { en: 'Purchases & Vendors', bn: 'ক্রয় ও সরবরাহকারী', hi: 'खरीद और विक्रेता' },
  accounting: { en: 'Accounting & Ledger', bn: 'হিসাব ও খতিয়ান', hi: 'लेखा और बहीखाता' },
  reports: { en: 'Reports & Analytics', bn: 'রিপোর্ট ও বিশ্লেষণ', hi: 'रिपोर्ट और विश्लेषण' },
  ecommerce: { en: 'Online Storefront', bn: 'অনলাইন স্টোর', hi: 'ऑनलाइन स्टोर' },
  loyalty: { en: 'Loyalty & Rewards', bn: 'লয়্যালটি ও রিওয়ার্ডস', hi: 'लॉयल्टी और रिवार्ड्स' },
  settings: { en: 'Business Settings', bn: 'সেটিংস', hi: 'सेटिंग्स' },
  logout: { en: 'Logout', bn: 'লগআউট', hi: 'लॉगआउट' },

  // Verticals
  restaurant: { en: 'Restaurant & Dining', bn: 'রেস্তোরাঁ ও ডাইনিং', hi: 'रेस्टोरेंट और डाइनिंग' },
  pharmacy: { en: 'Pharmacy & Batches', bn: 'ফার্মেসি ও ব্যাচ', hi: 'फार्मेसी और बैच' },
  clothing: { en: 'Garments & Sizes', bn: 'পোশাক ও সাইজ ভ্যারিয়েন্ট', hi: 'वस्त्र और साइज' },
  manufacturing: { en: 'Manufacturing & BOM', bn: 'ম্যানুফ্যাকচারিং ও বিওএম', hi: 'विनिर्माण और बीओएम' },
  school: { en: 'School & Fee Management', bn: 'স্কুল ও ফি কালেকশন', hi: 'स्कूल और फीस प्रबंधन' },
  wholesale: { en: 'Wholesale & Distribution', bn: 'পাইকারি ও বিতরণ', hi: 'थोक और वितरण' },
  service: { en: 'Service & Work Orders', bn: 'সার্ভিস ও জব কার্ড', hi: 'सेवा और वर्क ऑर्डर' },

  // Common Actions
  search: { en: 'Search...', bn: 'অনুসন্ধান করুন...', hi: 'खोजें...' },
  save: { en: 'Save', bn: 'সংরক্ষণ করুন', hi: 'सहेजें' },
  cancel: { en: 'Cancel', bn: 'বাতিল', hi: 'रद्द करें' },
  add: { en: 'Add New', bn: 'নতুন যোগ করুন', hi: 'नया जोड़ें' },
  edit: { en: 'Edit', bn: 'সম্পাদনা', hi: 'संपादित करें' },
  delete: { en: 'Delete', bn: 'মুছে ফেলুন', hi: 'हटाएं' },
  export: { en: 'Export', bn: 'রপ্তানি', hi: 'निर्यात' },
  print: { en: 'Print', bn: 'প্রিন্ট', hi: 'प्रिंट' },
  filter: { en: 'Filter', bn: 'ফিল্টার', hi: 'फ़िल्टर' },
  status: { en: 'Status', bn: 'অবস্থা', hi: 'स्थिति' },
  actions: { en: 'Actions', bn: 'অ্যাকশন', hi: 'कार्रवाई' },
  total: { en: 'Total', bn: 'মোট', hi: 'कुल' },
  balance: { en: 'Balance', bn: 'বকেয়া', hi: 'बकाया' },
  paid: { en: 'Paid', bn: 'পরিশোধিত', hi: 'भुगतान किया' },
  unpaid: { en: 'Unpaid', bn: 'অপরিশোধিত', hi: 'अदत्त' },
  due: { en: 'Due Amount', bn: 'বকেয়া পরিমাণ', hi: 'बकाया राशि' },
  loading: { en: 'Loading...', bn: 'লোড হচ্ছে...', hi: 'लोड हो रहा है...' },
  refresh: { en: 'Refresh', bn: 'রিফ্রেশ', hi: 'रिफ्रेश' },
  date: { en: 'Date', bn: 'তারিখ', hi: 'तारीख' },
  amount: { en: 'Amount', bn: 'টাকার পরিমাণ', hi: 'राशि' },
  type: { en: 'Type', bn: 'ধরন', hi: 'प्रकार' },
  notes: { en: 'Notes / Remarks', bn: 'মন্তব্য', hi: 'टिप्पणियाँ' },

  // Loyalty specifics
  loyaltyProgram: { en: 'Customer Loyalty & Points Ledger', bn: 'গ্রাহক লয়্যালটি ও পয়েন্ট লেজার', hi: 'ग्राहक लॉयल्टी और रिवार्ड लेजर' },
  earnRules: { en: 'Earning & Redemption Rules', bn: 'পয়েন্ট অর্জন ও ভাঙানোর নিয়ম', hi: 'पॉइंट अर्जन और भुनाने के नियम' },
  pointsPerSpend: { en: 'Earn Rate', bn: 'পয়েন্ট অর্জনের হার', hi: 'पॉइंट अर्जन दर' },
  redemptionValue: { en: 'Redemption Value', bn: 'প্রতি পয়েন্টের মূল্যমান', hi: 'प्रति पॉइंट मूल्य' },
  minRedeem: { en: 'Minimum Points to Redeem', bn: 'ভাঙানোর সর্বনিম্ন পয়েন্ট', hi: 'न्यूनतम रिडीम पॉइंट' },
  totalPoints: { en: 'Loyalty Points', bn: 'লয়্যালটি পয়েন্ট', hi: 'लॉयल्टी पॉइंट्स' },
  adjustPoints: { en: 'Adjust Points', bn: 'পয়েন্ট সমন্বয় করুন', hi: 'पॉइंट समायोजित करें' },

  // School specifics
  studentDirectory: { en: 'Student Directory', bn: 'শিক্ষার্থী তালিকা', hi: 'विद्यार्थी सूची' },
  feeCollection: { en: 'Fee Collection', bn: 'ফি আদায়', hi: 'शुल्क संग्रह' },
  feeReceipts: { en: 'Fee Receipts', bn: 'ফি রসিদসমূহ', hi: 'फीस रसीदें' },
  feeStructures: { en: 'Fee Structures', bn: 'ফি কাঠামো', hi: 'फीस संरचना' },
  admissionNo: { en: 'Admission No', bn: 'ভর্তি নম্বর', hi: 'प्रवेश संख्या' },
  studentName: { en: 'Student Name', bn: 'শিক্ষার্থীর নাম', hi: 'विद्यार्थी का नाम' },
  classGrade: { en: 'Class / Grade', bn: 'শ্রেণি / গ্রেড', hi: 'कक्षा / ग्रेड' },
  section: { en: 'Section', bn: 'শাখা', hi: 'अनुभाग' },
  guardianName: { en: 'Guardian / Parent', bn: 'অভিভাবক', hi: 'अभिभावक' },
  guardianPhone: { en: 'Guardian Phone', bn: 'অভিভাবকের ফোন', hi: 'अभिभावक फोन' },
  collectFee: { en: 'Collect Fee', bn: 'ফি গ্রহণ করুন', hi: 'फीस जमा करें' },
  receiptNo: { en: 'Receipt No', bn: 'রসিদ নং', hi: 'रसीद संख्या' },
};

interface LanguageContextType {
  language: Language;
  setLanguage: (lang: Language) => void;
  t: (key: string, fallback?: string) => string;
}

const LanguageContext = createContext<LanguageContextType>({
  language: 'en',
  setLanguage: () => {},
  t: (key: string, fallback?: string) => fallback || key,
});

export const LanguageProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [language, setLanguageState] = useState<Language>(() => {
    const saved = localStorage.getItem('apna_billing_language');
    if (saved === 'bn' || saved === 'hi' || saved === 'en') {
      return saved;
    }
    return 'en';
  });

  const setLanguage = (lang: Language) => {
    setLanguageState(lang);
    localStorage.setItem('apna_billing_language', lang);
  };

  const t = (key: string, fallback?: string): string => {
    if (translations[key] && translations[key][language]) {
      return translations[key][language];
    }
    return fallback || key;
  };

  return (
    <LanguageContext.Provider value={{ language, setLanguage, t }}>
      {children}
    </LanguageContext.Provider>
  );
};

export const useLanguage = () => useContext(LanguageContext);
