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
    <p class="last-updated">Last updated: November 16th, 2025</p>
    <h4>Nexus Moves &mdash; Terms of Service (Full Rewrite)</h4>

    <h5>1. Introduction</h5>
    <p>
      Welcome to Nexus Moves (“Nexus Moves”, “we”, “our”, or “us”). These Terms of Service (“Terms” or “Agreement”)
      govern your use of Nexus Moves’ home-inventory and moving-related services, including our mobile and web
      applications, inventory tools, and estimate-generation services (collectively, the “Service”).
    </p>
    <p>
      By accessing or using the Service, you agree to be bound by these Terms and our Privacy Policy. If you do not
      agree, you may not use the Service.
    </p>
    <p>
      You represent that you are at least 18 years old and have the authority to enter into this Agreement on your
      own behalf or on behalf of an organization.
    </p>
    <p>
      We may update these Terms from time to time. Your continued use of the Service after changes are posted
      constitutes acceptance of the updated Terms.
    </p>

    <h5>2. The Service</h5>
    <p>
      Nexus Moves provides tools and services to help users document their household items, plan for moves, and obtain
      estimated or “Guaranteed” moving costs.
    </p>
    <p>The Service includes:</p>
    <h6>a. Home Inventory Application</h6>
    <p>
      You may upload images, descriptions, and item information to create a digital home inventory. You are solely
      responsible for the accuracy and completeness of all submitted information.
    </p>
    <p>
      While Nexus Moves takes commercially reasonable steps to safeguard data, we do not guarantee against loss,
      corruption, or unauthorized access.
    </p>
    <h6>b. Moving Preparation &amp; Estimates</h6>
    <p>
      Nexus Moves generates moving cost estimates—either “Estimated” or “Guaranteed.” All estimates, including
      Guaranteed Estimates, are based entirely on the information you provide. You agree that:
    </p>
    <ul>
      <li>AI-generated weights, volumes, classifications, and descriptions are approximate only</li>
      <li>You must review and correct all inventory data</li>
      <li>Nexus Moves is not responsible for errors, omissions, or inaccuracies in your inventory</li>
    </ul>

    <h5>3. Guaranteed Estimate Terms</h5>
    <p>A “Guaranteed Estimate” is a price Nexus Moves will honor only if all conditions below are met.</p>

    <h6>a. Eligibility Conditions</h6>
    <p>A Guaranteed Estimate is valid only if:</p>
    <ul>
      <li>Inventory accuracy: The actual weight or volume of the shipment is within ±10% of the estimate</li>
      <li>No additional items, boxes, furniture, or materials are added beyond what appears in the verified inventory</li>
      <li>Stairs / access: You accurately report the number of stairs, elevators, long carries, parking constraints, and any unique access situations</li>
      <li>Item restrictions: No hazardous, restricted, or disallowed materials are included</li>
      <li>Availability: Movers must be available on the requested move date</li>
      <li>User conduct: No fraud, intentional misrepresentation, or concealment of material information</li>
    </ul>

    <h6>b. When Guaranteed Estimates May Be Modified or Voided</h6>
    <p>Nexus Moves reserves the right to revise or void a Guaranteed Estimate if:</p>
    <ul>
      <li>Your inventory is incomplete or inaccurate</li>
      <li>Weight or volume exceeds the estimate by more than 10%</li>
      <li>Additional services are required (packing, disassembly, shuttle vehicles, storage, long carries, etc.)</li>
      <li>You misrepresent stairs, access, parking, or unique move conditions</li>
      <li>Hazardous or prohibited items are included</li>
      <li>Conditions change outside your control (elevator outages, construction, etc.)</li>
      <li>Force majeure events occur</li>
      <li>Fraud, negligence, or intentional omission is discovered</li>
    </ul>

    <h6>c. Scope of Guarantee</h6>
    <p>
      The guarantee applies only to moves performed by Nexus Moves itself, not by third-party movers. Nexus Moves is
      responsible only for its own services, not the services of any other moving company.
    </p>

    <h5>4. AI-Generated Data Disclaimer</h5>
    <p>
      The Service may use AI to estimate item characteristics such as: Weight, Volume, Dimensions, Category,
      Description, Quantity.
    </p>
    <p>All AI-generated information is approximate and for convenience only. You acknowledge that:</p>
    <ul>
      <li>Nexus Moves does not guarantee the accuracy of AI-generated outputs</li>
      <li>You are solely responsible for reviewing and correcting inventory data</li>
      <li>Nexus Moves is not liable for costs or consequences arising from inaccurate data</li>
    </ul>

    <h5>5. Data Use and Rights</h5>
    <p>
      By submitting data (including images, descriptions, metadata, and inventory details), you grant Nexus Moves a
      worldwide, perpetual, irrevocable, royalty-free license to use, process, analyze, store, modify, and reproduce the
      data to provide the Service.
    </p>
    <p>
      You grant a right to use anonymized or aggregated data to improve models, algorithms, and Service quality, and
      permission to use anonymized inventory data to train AI systems.
    </p>
    <p>You retain ownership of your content.</p>

    <h5>6. Data Retention</h5>
    <p>If you delete your account:</p>
    <ul>
      <li>Your personal data will be removed or anonymized within 30–90 days, except where required for legal or operational reasons (e.g., billing, fraud prevention, dispute resolution)</li>
      <li>We may retain anonymized and aggregated data indefinitely.</li>
    </ul>

    <h5>7. User Accounts</h5>
    <p>
      You must provide accurate, current information when creating an account. You are responsible for maintaining the
      confidentiality of your password and for all activity under your account. You must notify Nexus Moves immediately
      if you suspect unauthorized access.
    </p>

    <h5>8. User Conduct</h5>
    <p>You agree not to upload or use the Service for:</p>
    <ul>
      <li>Illegal or harmful content</li>
      <li>Malware, malicious scripts, or harmful code</li>
      <li>Defamation, harassment, or abuse</li>
      <li>Intellectual property violations</li>
      <li>Fraudulent or misleading inventory creation</li>
      <li>Attempting to bypass safety, estimation, or verification systems</li>
    </ul>
    <p>Nexus Moves may remove content or terminate accounts at its discretion.</p>

    <h5>9. Third-Party Services</h5>
    <p>The Service may integrate with or refer you to third-party movers or vendors. You agree that:</p>
    <ul>
      <li>Nexus Moves is not responsible for the acts, omissions, pricing, service quality, or delays of third-party movers</li>
      <li>Nexus Moves does not guarantee that third-party movers will honor their estimates</li>
      <li>You release Nexus Moves from any claims arising from third-party services</li>
    </ul>

    <h5>10. Limitation of Liability</h5>
    <p>To the fullest extent permitted by law:</p>
    <ul>
      <li>Nexus Moves’ total liability for any claim is limited to the greater of: (a) the amount you paid to Nexus Moves, or (b) $100 USD</li>
      <li>Nexus Moves is not liable for: Lost or damaged items during a move; Inaccurate estimates (AI-generated or manual); Third-party mover actions; Business interruption, lost profits, or consequential damages; Data loss or corruption; Service availability issues; User errors, omissions, or misstatements</li>
      <li>Some jurisdictions do not allow such exclusions, so certain limitations may not apply.</li>
    </ul>

    <h5>11. No Warranties – “AS IS” Service</h5>
    <p>
      The Service is provided “AS IS” and “AS AVAILABLE” without warranties of any kind, express or implied. We do
      not warrant that: Estimates will be accurate; The Service will be error-free or uninterrupted; AI-generated data
      will be correct; Inventory data will be preserved without loss; The Service will meet your expectations.
    </p>

    <h5>12. Termination</h5>
    <p>
      We may suspend or terminate your account at any time for violation of these Terms or for any other reason at our
      discretion. Upon termination, your right to use the Service ends immediately.
    </p>

    <h5>13. Governing Law &amp; Dispute Resolution</h5>
    <p>
      These Terms are governed by the laws of the State of California, without regard to conflict-of-law rules. You
      agree to first attempt to resolve disputes informally by contacting us. If unresolved, disputes must be resolved
      through binding arbitration (to be added if you want a full arbitration clause and class-action waiver).
    </p>

    <h5>14. Severability</h5>
    <p>If any provision is found unenforceable, the remainder of the Terms remains in effect.</p>

    <h5>15. Changes to the Terms</h5>
    <p>
      We may modify the Terms at any time. If changes are material, we will provide notice at least 30 days before the
      new Terms take effect. Your continued use of the Service constitutes acceptance.
    </p>

    <h5>16. Contact</h5>
    <p>If you have questions, contact us at: support@nexus-moves.com (or your preferred email)</p>
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

p {
  margin: 8px 0;
  color: #374151;
}

ul {
  margin: 8px 0 12px 20px;
  color: #374151;
}
</style>
