<script setup lang="ts">
import { onMounted } from 'vue';

const emits = defineEmits<{
  (e: 'app:loading', value: boolean): void;
}>();

onMounted(() => {
  emits('app:loading', false);
});
</script>

<template>
  <div class="content">
    <h4>Nexus Moves Privacy Policy</h4>
    <p class="last-updated">Last updated: November 16th, 2025</p>

    <p>
      This Privacy Policy describes how Nexus Moves (“Nexus Moves”, “we”, “our”, or “us”) collects, uses, stores, shares, and
      protects your information when you access or use our website, applications, and services (collectively, the “Service”).
      It also explains your privacy rights and how the law protects you.
    </p>
    <p>
      By using the Service, you agree to the practices described in this Privacy Policy. If you do not agree, you may not access or use the Service.
    </p>

    <h5>1. Interpretation and Definitions</h5>
    <p class="subtitle">Interpretation</p>
    <p>Capitalized terms have meanings defined in this section. These definitions apply whether terms are singular or plural.</p>
    <p class="subtitle">Definitions</p>
    <ul>
      <li><strong>Account:</strong> A unique account created for you to access our Service.</li>
      <li><strong>Company:</strong> Nexus Moves.</li>
      <li><strong>Cookies:</strong> Small files stored on your device that help operate, analyze, and personalize the Service.</li>
      <li><strong>Country:</strong> California, United States.</li>
      <li><strong>Device:</strong> Any device capable of accessing the Service, such as phones, tablets, or computers.</li>
      <li><strong>Personal Data:</strong> Information identifying, relating to, or capable of being linked to an individual.</li>
      <li><strong>Service:</strong> The Nexus Moves website, mobile app, software, and tools.</li>
      <li><strong>Service Provider:</strong> Third parties that process data on our behalf.</li>
      <li><strong>Usage Data:</strong> Data collected automatically through your use of the Service.</li>
      <li><strong>Website:</strong> www.reloprep.com (or any subdomains operated by Nexus Moves).</li>
      <li><strong>You:</strong> The individual or entity accessing or using the Service.</li>
    </ul>

    <h5>2. Types of Data We Collect</h5>
    <p class="subtitle">a. Personal Data You Provide</p>
    <p>We may collect Personal Data, including:</p>
    <ul>
      <li>Name</li>
      <li>Email address</li>
      <li>Phone number</li>
      <li>Physical address (for moves)</li>
      <li>Move dates, locations, and service preferences</li>
      <li>Payment information (processed by third-party providers)</li>
      <li>Inventory information you upload (photos, descriptions, categories, quantities)</li>
    </ul>

    <p class="subtitle">b. Inventory Images and Metadata</p>
    <p>When you upload photos or item information, we may collect:</p>
    <ul>
      <li>Images and videos</li>
      <li>Metadata such as timestamps, device details, and geolocation (if enabled)</li>
      <li>AI-generated estimates (weights, volumes, classifications, descriptions)</li>
    </ul>

    <p class="subtitle">c. Usage Data</p>
    <p>Collected automatically, including:</p>
    <ul>
      <li>IP address</li>
      <li>Browser type and version</li>
      <li>Pages visited</li>
      <li>Device information</li>
      <li>Time spent on pages</li>
      <li>Unique identifiers</li>
      <li>Diagnostic data</li>
      <li>App activity logs</li>
    </ul>

    <p class="subtitle">d. Cookies and Tracking Technologies</p>
    <p>We use:</p>
    <ul>
      <li>Session Cookies (deleted after closing your browser)</li>
      <li>Persistent Cookies (remain until expiration)</li>
      <li>Web beacons, tags, pixels, and similar technologies</li>
    </ul>
    <p>These tools help operate the Service, authenticate users, prevent fraud, analyze usage, and remember your preferences.</p>

    <h5>3. How We Use Your Personal Data</h5>
    <p>Nexus Moves may use your data for the following purposes:</p>
    <p class="subtitle">a. To Provide and Maintain the Service</p>
    <ul>
      <li>Operating the Nexus Moves inventory system</li>
      <li>Generating moving estimates (including “Guaranteed Estimates”)</li>
      <li>Scheduling moves</li>
      <li>Processing payments</li>
      <li>Authenticating user accounts</li>
    </ul>
    <p class="subtitle">b. To Improve the Service and Train AI Models</p>
    <p>You agree that Nexus Moves may use: inventory images, descriptions, metadata, AI-generated results to train, improve, and refine our models, including AI systems used for item recognition, weight/volume estimation, and service optimization. Whenever possible, data is anonymized or aggregated.</p>
    <p class="subtitle">c. To Contact You</p>
    <p>For: account updates; service notifications; move reminders; customer support; required legal notices.</p>
    <p class="subtitle">d. To Send Marketing Communications (Optional)</p>
    <p>We may send promotions, product updates, and recommendations. You may opt out at any time.</p>
    <p class="subtitle">e. To Manage Your Requests</p>
    <p>Including responding to support inquiries and resolving issues.</p>
    <p class="subtitle">f. For Business Operations</p>
    <p>Including analytics, quality improvement, audits, and research.</p>
    <p class="subtitle">g. For Legal and Compliance Purposes</p>
    <p>Including fraud prevention, dispute resolution, enforcing Terms of Service, and responding to legal requests.</p>
    <p class="subtitle">h. For Business Transfers</p>
    <p>Your data may be used or transferred in corporate transactions such as mergers or acquisitions.</p>

    <h5>4. How We Share Your Information</h5>
    <p>We may share your Personal Data with:</p>
    <p class="subtitle">a. Service Providers</p>
    <p>For hosting, analytics, messaging, payment processing, customer support, cloud storage, AI model services. These partners process data only under our instructions.</p>
    <p class="subtitle">b. Moving Partners</p>
    <p>If you schedule or request services involving third-party movers, we may share: contact information, move details, inventory lists, photos and item descriptions.</p>
    <p class="subtitle">c. Business Partners</p>
    <p>To offer integrated or co-marketed services (opt-in where required).</p>
    <p class="subtitle">d. Business Transfers</p>
    <p>Your data may be transferred as part of mergers, acquisitions, or asset sales.</p>
    <p class="subtitle">e. With Your Consent</p>
    <p>For any purpose you explicitly approve.</p>
    <p class="subtitle">f. Legal Compliance</p>
    <p>We may disclose your data to law enforcement, courts, and regulators when required by law or necessary to protect rights, safety, or property.</p>

    <h5>5. Retention of Your Personal Data</h5>
    <p>We retain Personal Data:</p>
    <ul>
      <li>Only as long as necessary for the purposes described in this Policy</li>
      <li>Longer if required for legal, operational, fraud-prevention, or accounting purposes</li>
    </ul>
    <p>Standard retention periods:</p>
    <ul>
      <li>Account data: deleted or anonymized 30–90 days after account deletion</li>
      <li>Usage Data: retained for internal analytics (typically shorter)</li>
      <li>Anonymized data: retained indefinitely</li>
      <li>Legal records: retained as required by law</li>
    </ul>

    <h5>6. Transfer of Personal Data</h5>
    <p>Your data may be processed and stored in locations outside your state or country. Nexus Moves: uses industry-standard security measures; ensures all transfers comply with applicable laws; requires recipients to maintain adequate protections.</p>

    <h5>7. Your Rights</h5>
    <p>Depending on your jurisdiction, you may have the right to: access your data; correct inaccurate data; delete your data; request restrictions on processing; opt out of certain uses (e.g., marketing); request a copy of your data.</p>
    <p>You can exercise rights via: account settings or emailing us at support@reloprep.com. We may retain certain data when legally allowed or required.</p>

    <h5>8. Delete Your Personal Data</h5>
    <p>You can request deletion of: your Account; your Personal Data; inventory images and metadata.</p>
    <p>Limitations apply for: fraud prevention; dispute resolution; legal compliance; operational needs (e.g., billing).</p>

    <h5>9. Children’s Privacy</h5>
    <p>The Service is not intended for individuals under 13. We do not knowingly collect data from children under 13. If you believe a child has provided Personal Data, contact us to have it removed.</p>

    <h5>10. Security of Your Personal Data</h5>
    <p>We use commercially reasonable safeguards, including: encryption; access controls; secure storage systems; monitoring and threat detection. However, no method of transmission or storage is 100% secure.</p>

    <h5>11. Links to Other Websites</h5>
    <p>Our Service may contain links to third-party websites. We are not responsible for their content, privacy practices, or security standards. Please review their privacy policies separately.</p>

    <h5>12. Changes to This Privacy Policy</h5>
    <p>We may update this Privacy Policy at any time. We will notify you of significant changes via: email; app or website notices; updated date at the top of this page. Your continued use of the Service after changes are posted signifies acceptance.</p>

    <h5>13. Contact Us</h5>
    <p>If you have questions, requests, or concerns about this Privacy Policy, you may contact us:</p>
    <p>Email: support@reloprep.com</p>
    <p>Website: https://www.reloprep.com</p>
  </div>
</template>

<style scoped>
.content {
  max-width: 900px;
  margin: 0 auto;
  padding: 24px 16px 64px;
  line-height: 1.6;
  color: #1f2a44;
}

.last-updated {
  color: #d32f2f;
  font-weight: 600;
}

h4, h5, h6 {
  margin-top: 20px;
  margin-bottom: 8px;
  color: #1f2a44;
}

.subtitle {
  font-weight: 700;
  color: #1f2a44;
  margin-top: 12px;
}

p {
  margin: 8px 0;
  color: #374151;
}

ul {
  margin: 8px 0 12px 20px;
  color: #374151;
}

strong {
  font-weight: 700;
}
</style>
