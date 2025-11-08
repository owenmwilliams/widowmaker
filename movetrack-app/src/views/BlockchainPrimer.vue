<script setup lang="ts">
// Define your script setup here
</script>

<template>
    <div>
        <div class="text-h5 text-weight-medium">How to read a contract</div>
        <div class="text-h6">State and mappings</div>
            <ol>
                <li class="q-mx-xl q-py-sm"><span class="text-weight-medium">State variables:</span> </li>
                <li class="q-mx-xl q-py-sm"><span class="text-weight-medium">One-way mappings:</span> </li>
                <li class="q-mx-xl q-py-sm"><span class="text-weight-medium">Changing state variables:</span> </li>
            </ol>
            
        <div class="text-h6">Functions</div>
            <ol>
                <li class="q-mx-xl q-py-sm"><span class="text-weight-medium">Checks on authorization:</span> This is where you perform all the necessary validations. Use require(), revert(), or assert() to ensure that conditions are met before executing any state changes. For instance, you might check if the sender has enough balance for a transaction or if they have the necessary permissions.</li>
                <li class="q-mx-xl q-py-sm"><span class="text-weight-medium">Effects on token state:</span> After passing the checks, you proceed to make the state changes. This includes updating state variables, executing internal logic, and so on. It's important to make all state changes before calling external contracts or sending ETH to mitigate the risk of reentrancy.</li>
                <li class="q-mx-xl q-py-sm"><span class="text-weight-medium">Interactions with contract / address:</span> Finally, you perform interactions with other contracts or addresses. This can include transferring ETH or calling functions of other contracts. Doing this last prevents potential reentrancy problems because all state modifications are already done, and the contract's state is consistent.</li>
                <li class="q-mx-xl q-py-sm"><span class="text-weight-medium">Logging events:</span> Emit events after the state changes to log the action. Events are used to notify external subscribers about the changes in the contract. This is typically done as the last step because it is not subject to reentrancy risks.</li>
            </ol>
        <div class="text-h6">Interacting with a contract</div>
            <ol>
                <li class="q-mx-xl q-py-sm"><span class="text-weight-medium">Reading token data:</span> </li>
                <li class="q-mx-xl q-py-sm"><span class="text-weight-medium">Contract as a mint:</span> </li>
                <li class="q-mx-xl q-py-sm"><span class="text-weight-medium">Updating token data:</span> </li>
            </ol>
        <div class="text-h5 text-weight-medium">Smart contracts and the blockchain</div>
      <p>
        Smart contracts are self-executing contracts with the terms of the agreement between buyer and seller being directly written into lines of code. They run on the Ethereum blockchain and can automatically enforce rules and execute actions when certain conditions are met.
      </p>
      <p>
        A smart contract undergoes several steps: agreement of terms, creation, deployment to blockchain, condition monitoring, execution, and recording on the blockchain.
      </p>
      <div class="text-h5 text-weight-medium">Smart contracts on the ethereum network</div>
      <p>
        Ethereum is a programmable blockchain where smart contracts are integral. These contracts can carry out complex algorithms, manage data, and interact with other contracts. Ethereum uses "gas" to measure and limit the computational work of contracts, enhancing security and efficiency.
      </p>
      <p>
        For more detailed information on Ethereum and smart contracts, visit 
        <a href="https://ethereum.org/en/developers/docs/smart-contracts/" target="_blank">Ethereum's official guide</a>.
      </p>
      <div class="text-h5 text-weight-medium">ERC721 tokens</div>
      <p>
        ERC721, a standard for Non-Fungible Tokens (NFTs) on Ethereum, allows for the creation of unique tokens, each with distinct properties. These tokens have become popular for digital art, collectibles, and other applications where uniqueness and provenance are key.
      </p>
      <p>
        Explore more about ERC721 and its use cases in the world of NFTs at 
        <a href="https://ethereum.org/en/developers/docs/standards/tokens/erc-721/" target="_blank">Ethereum's ERC721 guide</a>.
      </p>
    </div>
    

    <div>
        <div class="text-h6">Ethereum contract and ERC-721 resources</div>
      <ul>
        <li>
          <a href="https://ethereum.org/developers/" target="_blank" rel="noopener noreferrer">
            Ethereum Developer Documentation
          </a>
        </li>
        <li>
          <a href="https://soliditylang.org/docs/" target="_blank" rel="noopener noreferrer">
            Solidity Documentation
          </a>
        </li>
        <li>
          <a href="https://www.trufflesuite.com/docs/truffle/overview" target="_blank" rel="noopener noreferrer">
            Truffle Framework
          </a>
        </li>
        <li>
          <a href="https://hardhat.org/" target="_blank" rel="noopener noreferrer">
            Hardhat
          </a>
        </li>
        <li>
          <a href="https://eips.ethereum.org/EIPS/eip-721" target="_blank" rel="noopener noreferrer">
            ERC-721 Token Standard
          </a>
        </li>
        <li>
          <a href="https://docs.openzeppelin.com/contracts/4.x/" target="_blank" rel="noopener noreferrer">
            OpenZeppelin Contracts
          </a>
        </li>
        <li>
          <a href="https://medium.com/crypto-currently/creating-your-own-cryptokitties-style-game-on-ethereum-651476dd6b2e" target="_blank" rel="noopener noreferrer">
            CryptoKitties ERC-721 Tutorial
          </a>
        </li>
        <!-- Add more resources here -->
      </ul>
    </div>
  </template>
    
  <style scoped>
  ul {
  list-style-type: disc; /* or 'none' if you don't want any bullet points */
  padding-left: 20px; /* Adjust the value as needed */
}

li {
  list-style-position: outside; /* Or 'outside', depending on preference */
}

ol {
  list-style-type: decimal; /* This will ensure numbers are used */
  padding-left: 20px; /* Add some left padding to make sure numbers are visible */
}

  </style>
  