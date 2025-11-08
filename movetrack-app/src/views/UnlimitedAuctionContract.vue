
<script setup>
    import CodeHighlighter from '../components/CodeHighlighter.vue';
    import router from '../router';

    const mappingCode = 
    `// Defining the owner of the contract
    address payable public contractOwner;

    // Defining a constant for the escrow amount to ensure sufficient funds to cover deposits
    uint256 public escrowAmount;

    // Maps a token ID to offer timestamp
    mapping(uint256 => uint256) public approveTimestamp;
    
    // Maps a token ID to a bool to check if the token has been frozen
    mapping(uint256 => bool) public frozenTokens;

    // Maps a token ID to the associated metadata
    mapping(uint256 => TokenMetadata) public tokenMetadata;
    
    // Maps a uri to a token ID
    mapping(string => uint256) public uriToken;

    // Maps a token ID to uri
    mapping(uint256 => string) public tokenUri;

    // Maps an address to all token IDs the address has an offer on
    mapping(address => uint256[]) public outstandingOffers;

    // Maps an address to all token IDs the address owns
    mapping(address => uint256[]) public ownedTokens;`

    const mintCode = 
    `// Function that generates a new token
    function safeMint(
        address recipient,
        string memory _title,
        string memory _description,
        string memory _url,
        uint256 _reserve
    ) public payable returns (uint256) {
        // Error #1: uri already exists - ensures that all uris are unique
        require(uriToken[_url] == 0, "1");
        
        // Error #2A: account has insufficient privileges - contract owner cannot mint a token
        require(contractOwner != recipient, '2');

        // Assigns the current counter as the token ID and increments the counter
        uint256 tokenId = _tokenIdCounter.current();
        _tokenIdCounter.increment();

        // Initializes a metadata object to assign the submitted metadata to the token ID
        TokenMetadata storage metadata = tokenMetadata[tokenId];
        
        // Assigns each value to the metadata struct
        metadata.title = _title;
        metadata.description = _description;
        metadata.reserve = _reserve;

        // Updates the metadata mapping to reference the metadata
        tokenMetadata[tokenId] = metadata;

        // Updates the ownedTokens mapping to include the token ID
        ownedTokens[recipient].push(tokenId);

        // Updates the uriToken mapping to include the token ID
        uriToken[_url] = tokenId;

        // Updates the tokenUri mapping to include the uri
        tokenUri[tokenId] = _url;

        // Mints the token according to ERC721 standards
        _mint(recipient, tokenId);

        // Logs transaction as if from the contract owner to the recipient at the reserve price
        log(contractOwner, recipient, tokenId, _reserve);

        // Returns the token ID to the caller
        return tokenId;
    }`;

    const offerCode = 
    `// Function that initiates an offer on a token, starting a transaction between seller and buyer
    function initiate(
        address payable buyer, 
        uint256 tokenId, 
        uint256 offer, 
        string memory physicalAddress
    ) public payable {
        // Error #3: offer does not reach reserve price
        require(msg.value >= tokenMetadata[tokenId].reserve, "3");
        
        // Retrieves the existing metadata object
        TokenMetadata storage metadata = tokenMetadata[tokenId];

        // Error #4: buyer already has an offer
        for (uint256 i = 0; i < metadata.offers.length; i++) {
            require(metadata.offers[i].buyer != buyer, "4");
        }

        // Error #5: token does not already have an approved address
        require(getApproved(tokenId) == address(0), "5");

        // Pushes the offer to the offers array on the metadata object
        metadata.offers.push(TokenOffer({
            offer: offer,
            buyer: buyer,
            physicalAddress: physicalAddress
        }));

        // Adds the token ID to the outstanding offers mapping for the buyer
        outstandingOffers[buyer].push(tokenId);

        // Increases the escrow amount by the amount deposited
        escrowAmount += offer;
    }`;

    const withdrawOfferCode = 
    `// Function that allows a buyer to withdraw an offer
    function withdrawOffer(
        address payable buyer, 
        uint256 tokenId
    ) external {        
        // Error #2B: account has insufficient privileges - buyer's offer has already been accepted
        require(!_isApprovedOrOwner(buyer, tokenId), "2");

        // Retrieves the existing metadata object
        TokenMetadata storage metadata = tokenMetadata[tokenId];

        // Iterates through the offers array to find the offer to withdraw
        for (uint i = 0; i < metadata.offers.length - 1; i++) {
            if (metadata.offers[i].buyer == buyer) {
                // Error #6: return of offer money failed
                require(buyer.send(metadata.offers[i].offer), "6");

                // Decreases the escrow amount by the amount withdrawn
                escrowAmount -= metadata.offers[i].offer;
                
                // Removes the offer from the offers array
                metadata.offers[i] = metadata.offers[i+1];
                metadata.offers.pop();

                // Removes the token ID from the outstanding offers mapping for the buyer
                arrayRemoveFromOffers(buyer, tokenId);
            }
        }
    }`;

    const finalizeTransactionCode = 
    `// Function that completes the transaction between seller and buyer
    function complete(address payable seller, address buyer, uint256 tokenId, uint256 reserve) public payable {
        // Error #2C: account has insufficient privileges - address is not eligible to complete the transaction
        require(
            // Buyer can always complete a transaction
            msg.sender == buyer || 
            // Contract owner can complete a transaction if it is frozen
            (msg.sender == contractOwner && frozenTokens[tokenId] == true) || 
            // Seller can complete a transaction if it is not frozen and it has been 30 days since the approval
            (block.timestamp > approveTimestamp[tokenId] + 30 days && frozenTokens[tokenId] == false && msg.sender == seller), "2");

        // Error #6: return of offer money failed
        require(seller.send(tokenMetadata[tokenId].offers[0].offer), "6");

        // Removes the offer amount from the escrow amount
        escrowAmount -= tokenMetadata[tokenId].offers[0].offer;

        // Transfers the token from the seller to the buyer
        safeTransferFrom(seller, buyer, tokenId);
        
        // Logs the transaction
        log(seller, buyer, tokenId, tokenMetadata[tokenId].offers[0].offer);

        // Clears offers in metadata for the transferred token
        delete tokenMetadata[tokenId].offers;

        // Updates reserve price to new owners reserve price
        tokenMetadata[tokenId].reserve = reserve;

        // Removes the token from the buyers outstanding offers
        arrayRemoveFromOffers(buyer, tokenId);
        
        // Removes the token from the sellers owned tokens
        arrayRemoveFromOwned(seller, tokenId);

        // Adds the token to the buyers owned tokens
        ownedTokens[buyer].push(tokenId);
    }`;

    const approveFunctionCode =
    `function approve(
        address to, 
        uint256 tokenId
    ) public virtual override {
        address owner = ERC721.ownerOf(tokenId);
        require(to != owner, "ERC721: approval to current owner");

        require(
            _msgSender() == owner || isApprovedForAll(owner, _msgSender()),
            "ERC721: approve caller is not token owner or approved for all"
        );

        _approve(to, tokenId);
    }`;

    const approveUpdateFunctionCode = 
    `// Function that allows a seller to approve a specific offer
    function approveOffer(address buyer, uint256 tokenId) public payable {
        
        // Approves the buyer to allow them to transfer the token
        approve(buyer, tokenId);

        // Returns all other offers on the token
        returnOffers(buyer, tokenId);

        // Logs the timestamp of the approval to start the timer till seller can withdraw
        approveTimestamp[tokenId] = block.timestamp;
    }`

    const freezeFunctionCode = 
    `// Function that freezes a token to stop it from completing until resolution
    function freezeToken(
        uint256 tokenId
    ) public {
        // Error #2D: account has insufficient privileges - only the buyer or seller can freeze
        require(_isApprovedOrOwner(msg.sender, tokenId), "2");

        // Sets the freeze mapping at token ID to true
        frozenTokens[tokenId] = true;
    }`

    const resolveFunctionCode = 
    `// Function that resolves a dispute between buyer and seller
    function resolve(
        uint256 tokenId, 
        uint8 resolution, 
        address payable seller, 
        address payable buyer
    ) public payable {
        // Error #2E: account has insufficient privileges - only contract owner can resolve
        require(msg.sender == contractOwner, "2");
        
        // Resolves the dispute in favor of the buyer
        if (resolution == 1) {
            
            // Return money to the buyer in the offers array (i.e., return all offers)
            returnOffers(msg.sender, tokenId);
            
            // Set all approvals back to zero
            _approve(address(0), tokenId);
        
        // Resolves the dispute in favor of the seller
        } else if (resolution == 2) {

            // Complete the transaction as normal
            complete(seller, buyer, tokenId, tokenMetadata[tokenId].reserve);
        
        // Resolves the dispute in favor of both (return money to buyer and seller at expense of contract owner)
        } else if (resolution == 3) {
            // Error #7: resolution of offer attempted with insufficient funds
            require(msg.value >= tokenMetadata[tokenId].offers[0].offer, "7");

            // Error #6: return of offer money failed
            require(seller.send(tokenMetadata[tokenId].offers[0].offer), "6");

            // Burns the token upon resolution (i.e., owned by neither buyer nor seller)
            burnToken(tokenId);
        }     

        // Unfreeze the token ID
        frozenTokens[tokenId] = false;   
    }`
</script>


<template>
    
    <div class="text-weight-medium text-h5 q-my-lg">
        Unlimited Auction Contract State Variables / Mappings
    </div>

    <q-card class="q-my-sm">
        <q-card-section horizontal>
            <q-card-section class="q-ma-sm">
                <div class="text-caption text-weight-light q-py-sm">
                    In a smart contract, mappings are crucial data structures that store and organize information directly on the blockchain. They are designed to manage various aspects of token-related data efficiently and securely. Each mapping associates keys to values, creating a persistent and accessible record of important details such as ownership status, token metadata, and the history of offers.
                </div>
                <div class="text-caption text-weight-light q-py-sm">
                    Mappings are particularly powerful in decentralized applications because they allow for quick and secure data retrieval without the need for a central database. They facilitate the direct linking of addresses to assets, tracking of unique digital items, and recording of user interactions with these assets. In your contract, they enable actions like checking whether a token is available for transfer, retrieving a token's descriptive information, and listing all offers made by a particular account.
                </div>
                <div class="text-caption text-weight-light q-py-sm">
                    This one-way association in mappings means that while you can retrieve the value associated with a specific key, you cannot traverse the mapping to obtain a list of all keys or values. This characteristic ensures that operations remain efficient as the size of the dataset grows. To maintain transparency and enable tracking of changes, events are often emitted in conjunction with mappings when state changes occur. These events are then used by user interfaces to reflect updates in real-time, providing users with the latest state of their tokens and offers.
                </div>

            </q-card-section>
            <q-space />
            <q-card-section class="q-ma-sm">
                <CodeHighlighter style="width: 60vw;" :codeText="mappingCode" />
            </q-card-section>
        </q-card-section>
        
    </q-card>

    <div class="text-weight-medium text-h5 q-my-lg">
        Unlimited Auction Contract Core Functions
    </div>

    <!-- Minting a token -->
    <q-card class="q-my-sm">
        <q-card-section>
            <div class="text-h6">Step 1. How do we list a new item for sale?</div>
        </q-card-section>
        <q-card-section>
            <div class="text-body2">
                When you wish to list an item on the marketplace, the process involves a transition from your personal inventory to the marketplace environment. 
                This is a necessary pathway, as direct listings on the marketplace are not supported. During this process, the item is removed from your inventory, 
                and in its place, a new immutable token is created. This token acts as a digital embodiment of your item, encapsulating key details such as the 
                item's description, name, and an image URL. Notably, the image URL is hosted on the InterPlanetary File System (IPFS), with its hash securely 
                stored on the blockchain. This method of listing ensures that once an item enters the marketplace, it is no longer under any centralized control 
                and becomes part of the wider, publicly accessible blockchain infrastructure. This transition represents a significant shift from traditional centralized 
                systems to a more open, decentralized framework, characteristic of blockchain technology.
            </div>
        </q-card-section>
        <q-card-section horizontal>
            <q-card-section class="q-ma-sm">
                <div class="text-caption text-weight-light q-py-sm">
                    This
                    <span class="text-caption text-weight-medium sameline q-py-sm text-secondary">
                        safeMint 
                    </span>
                    function is a part of a smart contract, commonly used in the world of blockchain and cryptocurrencies. 
                    It's designed to create, or "mint," a new digital token. Think of it like manufacturing a unique digital collectible or asset. 
                    When this function is called, it generates a new token and assigns it to a recipient's address, which is like a digital mailbox 
                    in the blockchain world. The function also requires specific details for the new token, like a title, description, and a URL, 
                    which are akin to giving this digital item a name, a story, and a picture or a link to represent it. Additionally, it sets a 
                    "reserve" value, which can be thought of as a minimum value or a special attribute for the token. However, this function has 
                    safety checks in place: it ensures that the URL for the new token hasn't been used before (to maintain uniqueness), that a minimum 
                    amount of Ether (a type of cryptocurrency) is paid to execute this function, and that the recipient isn't the owner of the contract 
                    (likely a rule to prevent self-dealing).
                </div>

                <div class="text-caption q-py-sm">
                    1. Check conditions:
                </div>
                <div class="text-caption text-weight-light q-py-sm">
                    Requirements ensure that certain conditions are met before proceeding with the transaction. You will see across most functions, a specific set of conditions required.
                </div>

                <div class="text-caption q-py-sm">
                    2. Token ID generation:
                </div>
                <div class="text-caption text-weight-light q-py-sm">
                    The function calculates a unique ID for the new token. This ID is like a serial number, ensuring each token is one-of-a-kind.
                </div>

                <div class="text-caption q-py-sm">
                    3. Setting token metadata and updating contract state:
                </div>
                <div class="text-caption text-weight-light q-py-sm">
                    Token metadata (title, description, URL, reserve) is set for the new token, linking these details to the token's ID. The function also keeps track of who owns the token initially and makes sure that the URL provided is marked as used.
                </div>

                <div class="text-caption q-py-sm">
                    4. Minting the token and logging the transaction:
                </div>
                <div class="text-caption text-weight-light q-py-sm">
                    The function officially creates the token and assigns it to the recipient's address. It also logs the minting event, recording details like who minted the token, who received it, and its unique ID. Finally, it returns the unique ID of the newly minted token.
                </div>

            </q-card-section>
            <q-space />
            <q-card-section class="q-ma-sm">
                <CodeHighlighter style="width: 60vw;" :codeText="mintCode" />
            </q-card-section>
        </q-card-section>
        
    </q-card>

    <!-- Making an offer -->
    <q-card class="q-my-md">
        <q-card-section>
            <div class="text-h6">Step 2. How do offers work?</div>
        </q-card-section>
        <q-card-section>
            <div class="text-body2">
                Offers are the key mechanism that drives the unlimited auction contract, enabling a seamless exchange between buyers and sellers. This process is broken down into distinct stages: making an offer, having it accepted, and 
                completing the transaction. Throughout these stages, the smart contract automates the rules, minimizing the need for intermediaries and ensuring a secure and transparent process.
            </div>
        </q-card-section>
        <q-card-section horizontal>
            <q-card-section class="q-ma-sm">
                
                <div class="text-caption text-weight-light q-py-sm">
                    This 
                    <span class="text-caption text-weight-medium sameline q-py-sm text-secondary">
                        initiate 
                    </span>
                    function is a part of a smart contract, typically used in blockchain technology for managing digital assets 
                    or tokens. In simple terms, this function is like starting a process to buy a unique digital item (token) with specific 
                    characteristics. When someone calls this function, they are expressing their intention to purchase a particular token, 
                    identified by its unique ID (tokenId), for a certain price (cost). They also provide their physical address as part of the 
                    transaction, which could be for shipping a physical counterpart of the digital item or for record-keeping purposes.
                </div>
                
                <div class="text-caption text-weight-light q-py-sm">
                    Let's break down what happens in this function. First, it checks if the amount of cryptocurrency (like Ether) sent with this 
                    transaction is at least equal to a minimum value (reserve) set for the token. This reserve is like a safety net to ensure the 
                    token isn't sold for less than its worth. Then, the function looks up the details of the token using its unique ID and goes 
                    through any existing offers made for this token. It checks to make sure the current buyer hasn't already made an offer for this 
                    token, as a way to prevent duplicate offers from the same buyer.
                </div>

                <div class="text-caption text-weight-light q-py-sm">
                    If everything checks out, the function proceeds to record the new offer. It saves the offered price, the buyer's address, and 
                    their physical address into the token's history of offers. These details are like adding a new bid in an auction record book, 
                    showing who wants to buy the token and for how much. Finally, the function increases a total amount, called escrowAmount, by 
                    the cost of the offer. Think of this as setting aside the buyer's offered amount in a secure place (escrow) as part of the ongoing 
                    transaction process. This step is crucial in transactions involving valuable digital assets, ensuring that funds are properly 
                    accounted for and managed during the buying process.
                </div>
            </q-card-section>
            <q-space />
            <q-card-section class="q-ma-sm">
                <CodeHighlighter style="width: 60vw;" :codeText="offerCode" />
            </q-card-section>
        </q-card-section>
        <q-separator />
        <q-card-section horizontal>
            <q-card-section class="q-ma-sm">
                
                <div class="text-caption text-weight-light q-py-sm">
                    The 
                    <span class="text-caption text-weight-medium sameline q-py-sm text-secondary">
                        withdrawOffer 
                    </span>
                    The withdrawOffer function in this smart contract is essentially a way for someone to retract a previously made offer to purchase
                        a digital token in the blockchain environment. This function is useful in scenarios where a buyer changes their mind or no longer 
                        wishes to proceed with the transaction for a specific token, identified by its unique ID (tokenId). Here's how the function works in layman's terms:
                    
                </div>
                
                <div class="text-caption q-py-sm">
                    1. Check for existing offer:
                </div>
                <div class="text-caption text-weight-light q-py-sm">
                    Initially, the function looks into the details of the token, specifically focusing on the offers made for it. It then checks if the buyer, 
                    identified by their address (buyer), has previously made an offer for this token. The function goes through all the offers recorded 
                    for the token and verifies whether any of them belong to the buyer in question.

                </div>

                <div class="text-caption q-py-sm">
                    2. Withdraw the offer:
                </div>
                <div class="text-caption text-weight-light q-py-sm">
                    If the buyer has indeed made an offer, the function starts the process of withdrawing that offer. To do this, it goes through 
                    the list of offers again. This time, when it finds the buyer's offer, it initiates a return of the funds that the buyer had offered 
                    for the token. The funds are sent back to the buyer's address, effectively canceling their bid. This step is like refunding a deposit 
                    in a traditional transaction.

                </div>
                <div class="text-caption q-py-sm">
                    3. Update offers and escrow amount:
                </div>
                <div class="text-caption text-weight-light q-py-sm">
                    
                    After refunding the buyer's offer, the function updates the list of offers for the token. It removes the buyer's offer from the 
                    list, ensuring that the offer records are accurate and up-to-date. Additionally, the function adjusts the total escrowAmount by 
                    subtracting the amount of the buyer's offer. The escrowAmount is a sum that represents all the active offers' values; by reducing 
                    it, the function correctly reflects the withdrawal of the offer.

                </div>
                <div class="text-caption text-weight-light q-py-sm">
                    This withdrawOffer function is important in managing the integrity of the buying process in a blockchain environment. It ensures 
                    that if a buyer decides not to proceed with a purchase, their offer can be safely and effectively withdrawn, keeping the transaction 
                    records accurate and fair.
                </div>
            </q-card-section>
            <q-space />
            <q-card-section class="q-ma-sm">
                <CodeHighlighter style="width: 60vw;" :codeText="withdrawOfferCode" />
            </q-card-section>
        </q-card-section>
        <q-separator />
        <q-card-section horizontal>
            <q-card-section class="q-ma-sm">
                <div class="text-caption text-weight-light q-py-sm">
                    The
                    <span class="text-caption text-weight-medium sameline q-py-sm text-secondary">
                        approve 
                    </span>
                    function is a standard part of many smart contracts that deal with ERC721 tokens, commonly known as NFTs (Non-Fungible Tokens). 
                    In simple terms, this function is used to give someone else permission to transfer a specific token on your behalf. It's a bit 
                    like giving someone a temporary key or authorization to handle a specific item that you own. Below is a brief explanation 
                    of what this function does (see <a href="https://eips.ethereum.org/EIPS/eip-721" target="_blank">ERC721 protocol</a> or 
                    <a href="https://docs.openzeppelin.com/contracts/2.x/api/token/erc721">Open Zeppelin docs</a> for more details):
                </div>

                <div class="text-caption q-py-sm">
                    1. Check ownership:
                </div>
                <div class="text-caption text-weight-light q-py-sm">
                    The function first determines who currently owns the token in question, using the token's unique ID (tokenId). It's important 
                    to know the current owner to ensure that only the rightful owner or an authorized person can grant permissions related to the token.
                </div>

                <div class="text-caption q-py-sm">
                    2. Prevent unnecessary approval:
                </div>
                <div class="text-caption text-weight-light q-py-sm">
                    Next, the function checks if the to address (the one being given permission) is not the same as the token's owner. This is a 
                    logical check to prevent a situation where the owner is giving approval to themselves, which is unnecessary.
                </div>
                
                <div class="text-caption q-py-sm">
                    3. Verify the caller's authority:
                </div>
                <div class="text-caption text-weight-light q-py-sm">
                    The function then checks if the person (or smart contract) calling this function (_msgSender()) is either the owner of the token 
                    or someone who has been given blanket approval to manage all of the owner's tokens (isApprovedForAll). This is a critical security 
                    step to ensure that only authorized individuals can set approvals.
                </div>

                <div class="text-caption q-py-sm">
                    4. Grant approval:
                </div>
                <div class="text-caption text-weight-light q-py-sm">
                    If all the above checks are passed, the function proceeds to _approve the specified address. This step is where the actual permission 
                    is granted. It allows the address specified in to to transfer the specific token (tokenId) on behalf of the owner. This can be useful 
                    in various scenarios, like allowing a marketplace to sell your token or letting a game or application use your token for a specific purpose.
                </div>

                <div class="text-caption text-weight-light q-py-sm">
                    In summary, the approve function is a key part of the ERC721 standard, providing a secure way to delegate the transfer authority 
                    of a specific token to another address. It ensures that only the token owner or an authorized individual can set such permissions, 
                    maintaining the security and integrity of token transactions and interactions in the blockchain ecosystem.
                </div>
                

            </q-card-section>
            <q-space />
            <q-card-section class="q-ma-sm">
                <CodeHighlighter style="width: 60vw;" :codeText="approveFunctionCode" />
                <q-space class="q-my-xl" /> 
                <CodeHighlighter style="width: 60vw;" :codeText="approveUpdateFunctionCode" />
                
            </q-card-section>
        </q-card-section>
    </q-card>

    <!-- Accepting offers and finalizing the transaction -->
    <q-card class="q-my-md">
        <q-card-section>
            <div class="text-h6">Step 3. How do we accept an offer and finalize a transaction?</div>
        </q-card-section>
        <q-card-section horizontal>
            <q-card-section class="q-ma-sm">
                <div class="text-caption text-weight-light q-py-sm">
                    The
                    <span class="text-caption text-weight-medium sameline q-py-sm text-secondary">
                        complete 
                    </span>
                    function in this smart contract is essentially a finalization process for a transaction involving a digital token (often referred 
                    to as an NFT, or Non-Fungible Token) within a blockchain system. This function is quite complex as it handles multiple steps to 
                    securely and fairly conclude the sale and transfer of a token from one party to another. Here's a breakdown of what this function 
                    does, in simpler terms:
                </div>
                

                <div class="text-caption q-py-sm">
                    1. Ensure sufficient funds:
                </div>
                <div class="text-caption text-weight-light q-py-sm">
                    The function first checks if the smart contract itself has enough Ether (the cryptocurrency used in many blockchain systems) to 
                    cover the transaction. This is important because the contract needs to have enough balance to handle the financial aspects of the 
                    deal, such as paying the seller and refunding any other offers.
                </div>

                <div class="text-caption q-py-sm">
                    2. Transfer payment to seller:
                </div>
                <div class="text-caption text-weight-light q-py-sm">
                    If the contract has enough funds, the function proceeds to transfer the specified amount of Ether to the seller. This step is akin 
                    to the seller receiving payment for the sale of the token. The amount transferred is then subtracted from a total amount called escrowAmount, 
                    which is like a holding account within the contract for all ongoing transactions.
                </div>

                <div class="text-caption q-py-sm">
                    3. Transfer the token:
                </div>
                <div class="text-caption text-weight-light q-py-sm">
                    Next, the function transfers the ownership of the NFT from the seller to the buyer. This is a crucial step where the digital asset (token) 
                    is officially moved to the buyer's possession, similar to handing over the keys to a new owner in a property transaction.
                </div>

                <div class="text-caption q-py-sm">
                    4. Refund other offers:
                </div>
                <div class="text-caption text-weight-light q-py-sm">
                    The function then addresses all other offers that were made for the same token. For each offer from a buyer who is not the final purchaser, 
                    the function refunds the offered amount back to these buyers. This step ensures that everyone who made an offer but didn't win the 
                    token gets their money back.
                </div>

                <div class="text-caption q-py-sm">
                    5. Clear all previous offers:
                </div>
                <div class="text-caption text-weight-light q-py-sm">
                    After handling the refunds, the function clears out all the previous offers for the token. This is like wiping the slate clean, ensuring 
                    that the record of offers only reflects the current state of affairs.
                </div>
                
                <div class="text-caption q-py-sm">
                    6. Update the token details:
                </div>
                <div class="text-caption text-weight-light q-py-sm">
                    The function updates the token's metadata, specifically its reserve price, to reflect any new conditions set by the new owner. The reserve price 
                    can be thought of as a minimum value or price floor for future transactions involving this token.
                </div>

                <div class="text-caption q-py-sm">
                    7. Remove approvals:
                </div>
                <div class="text-caption text-weight-light q-py-sm">
                    As a security measure, the function also removes any existing approvals associated with the token. This is similar to revoking permissions or 
                    access rights in a digital system, ensuring that only the new owner has control over the token.
                </div>
                
                <div class="text-caption q-py-sm">
                    8. Record the transaction details:
                </div>
                <div class="text-caption text-weight-light q-py-sm">
                    Finally, the function logs the transaction, detailing the seller, buyer, token ID, and the amount involved. This step is crucial for maintaining 
                    a transparent and traceable record of the transaction on the blockchain.
                </div>

                <div class="text-caption text-weight-light q-py-sm">
                    In summary, the complete function handles the intricate process of finalizing a token sale, including financial transfers, ownership transfer, 
                    refunds to unsuccessful bidders, and updating the token's metadata, all while ensuring transparency and security as per the 
                    norms of blockchain transactions.
                </div>
                
            </q-card-section>
            <q-space />
            <q-card-section class="q-ma-sm">
                <CodeHighlighter style="width: 60vw;" :codeText="finalizeTransactionCode" />
            </q-card-section>
        </q-card-section>
        
    </q-card>

    <!-- Freezing a transaction and resolving a dispute -->
    <q-card class="q-my-md">
        <q-card-section>
            <div class="text-h6">Step 4. If we would like to dispute a transaction, what can we do?</div>
        </q-card-section>
        <q-card-section horizontal>
            <q-card-section class="q-ma-sm">
                <div class="text-caption text-weight-light q-py-sm">
                    The
                    <span class="text-caption text-weight-medium sameline q-py-sm text-secondary">
                        freezeToken 
                    </span>
                    function is intended to "freeze" a specific token, preventing any further actions or transactions involving that token until a resolution is reached. This is typically used in scenarios where there's a dispute or a need for investigation.
                </div>
                <div class="text-caption text-weight-light q-py-sm">
                    The require statement checks if the caller (msg.sender) is either the approved account or the owner of the token. If not, it throws an error, ensuring only authorized users can freeze the token.

                    It sets the frozenTokens status of the specified tokenId to true, indicating that the token is now frozen. In the complete function, a check is made for frozen status with the 
                    <span class="text-caption text-weight-medium sameline q-pa-xs text-primary">
                        && frozenTokens[tokenId] == false 
                    </span>
                    statement.
                </div>
                
            </q-card-section>
            
            <q-space />
            <q-card-section class="q-ma-sm">
                <CodeHighlighter style="width: 60vw;" :codeText="freezeFunctionCode" />
            </q-card-section>
        </q-card-section>
        <q-separator />

            <q-card-section horizontal>
                <q-card-section class="q-ma-sm">
                <div class="text-caption text-weight-light q-py-sm">
                    The
                    <span class="text-caption text-weight-medium sameline q-py-sm text-secondary">
                        resolve 
                    </span>
                    function is used to resolve disputes regarding a particular token. It handles the outcome based on the provided resolution parameter - resolution cases include:
                </div>
                <div class="text-caption q-py-sm">
                    1. In favor of the buyer (resolution == 1):
                </div>
                <div class="text-caption text-weight-light q-py-sm">
                    It returns all offers made on the token to the buyer through the returnOffers function.
                    It resets the token's approval status, essentially nullifying any previous approvals.
                </div>
                <div class="text-caption q-py-sm">
                    2. In favor of the seller (resolution == 2):
                </div>
                <div class="text-caption text-weight-light q-py-sm">
                    It proceeds to complete the transaction as normal, transferring ownership of the token to the buyer and handling any financial transactions.
                </div>
                <div class="text-caption q-py-sm">
                    3. In favor of both parties (resolution == 3):
                </div>
                <div class="text-caption text-weight-light q-py-sm">
                    Checks if the contract has enough funds to cover the resolution with additional funds being added. Returns money to the buyer AND the seller. 
                    Burns the token, making it owned by neither party, cancelling any futher transactions with this item.
                </div>

                <div class="text-caption text-weight-light q-py-sm">
                    Regardless of the resolution outcome, the function unfreezes the token by setting its status to false in frozenTokens.
                </div>
                
                
                
            </q-card-section>
            <q-space />
            <q-card-section class="q-ma-sm">
                <CodeHighlighter style="width: 60vw;" :codeText="resolveFunctionCode" />
            </q-card-section>
            </q-card-section>
        
        
    </q-card>
    
</template>
  

  